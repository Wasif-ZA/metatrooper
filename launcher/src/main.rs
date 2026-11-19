#[cfg(not(windows))]
fn main() {
    eprintln!("metatrooper-launch is Windows only");
    std::process::exit(1);
}
#[cfg(windows)]
fn main() {
    win::main();
}
#[cfg(windows)]
mod win {
    use std::{
        env,
        ffi::c_void,
        io::{self, BufRead, Write},
        mem,
        process::{self, Command},
        ptr, thread,
        collections::HashSet,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Basic { process_time: i64, job_time: i64, flags: u32, min_ws: usize, max_ws: usize, active: u32, affinity: usize, priority: u32, scheduling: u32, }
    #[repr(C)]
    #[derive(Default)]
    struct Limits { basic: Basic, io: [u64; 6], process_memory: usize, job_memory: usize, peak_process: usize, peak_job: usize, }
    #[repr(C)]
    struct Overlapped { internal: usize, internal_high: usize, offset: u32, offset_high: u32, event: Handle, }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: u32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn GetLastError() -> u32;
        fn CloseHandle(handle: Handle) -> i32;
        fn SetConsoleCtrlHandler(handler: Option<unsafe extern "system" fn(u32) -> i32>, add: i32) -> i32;
        fn CreateFileW(name: *const u16, access: u32, share: u32, attributes: *const c_void,
            disposition: u32, flags: u32, template: Handle) -> Handle;
        fn WaitNamedPipeW(name: *const u16, timeout: u32) -> i32;
        fn CreateEventW(attributes: *const c_void, manual: i32, initial: i32, name: *const u16) -> Handle;
        fn ReadFile(handle: Handle, buffer: *mut u8, size: u32, read: *mut u32, overlapped: *mut Overlapped) -> i32;
        fn WriteFile(handle: Handle, buffer: *const u8, size: u32, written: *mut u32, overlapped: *mut Overlapped) -> i32;
        fn GetOverlappedResult(handle: Handle, overlapped: *mut Overlapped, count: *mut u32, wait: i32) -> i32;
    }
    unsafe extern "system" fn ctrl(kind: u32) -> i32 {
        i32::from(kind == 0 || kind == 1)
    }
    fn job() -> Handle {
        unsafe {
            let handle = CreateJobObjectW(ptr::null(), ptr::null());
            let mut limits = Limits::default();
            limits.basic.flags = 0x2000;
            if handle.is_null()
                || SetInformationJobObject(handle, 9, &limits as *const _ as _, mem::size_of_val(&limits) as u32) == 0
                || AssignProcessToJobObject(handle, GetCurrentProcess()) == 0
            {
                let error = GetLastError();
                if !handle.is_null() { CloseHandle(handle); }
                eprintln!("troop launch: job object unavailable ({error})");
                return ptr::null_mut();
            }
            handle
        }
    }
    fn base64(text: &str) -> Option<String> {
        let bytes = text.as_bytes();
        if bytes.len() % 4 != 0 { return None; }
        let mut out = Vec::new();
        for (index, chunk) in bytes.chunks(4).enumerate() {
            let mut value = 0u32;
            let mut padding = 0;
            for &byte in chunk {
                let digit = match byte {
                    b'A'..=b'Z' => byte - b'A',
                    b'a'..=b'z' => byte - b'a' + 26,
                    b'0'..=b'9' => byte - b'0' + 52,
                    b'+' => 62,
                    b'/' => 63,
                    b'=' => {
                        padding += 1;
                        0
                    }
                    _ => return None,
                };
                if padding > 0 && byte != b'=' { return None; }
                value = (value << 6) | digit as u32;
            }
            if padding > 2
                || (padding > 0 && index + 1 != bytes.len() / 4)
                || (padding == 1 && value & 0xff != 0)
                || (padding == 2 && value & 0xffff != 0)
            {
                return None;
            }
            out.push((value >> 16) as u8);
            if padding < 2 { out.push((value >> 8) as u8); }
            if padding == 0 { out.push(value as u8); }
        }
        String::from_utf8(out).ok()
    }
    struct Json<'a> {
        text: &'a [u8],
        pos: usize,
    }
    impl<'a> Json<'a> {
        fn ws(&mut self) {
            while self.pos < self.text.len() && matches!(self.text[self.pos], b' ' | b'\t' | b'\r' | b'\n') {
                self.pos += 1;
            }
        }
        fn take(&mut self, byte: u8) -> Option<()> {
            self.ws();
            if self.text.get(self.pos) != Some(&byte) { return None; }
            self.pos += 1;
            Some(())
        }
        fn hex(&mut self) -> Option<u32> {
            let mut v = 0;
            for _ in 0..4 {
                v = v * 16 + (*self.text.get(self.pos)? as char).to_digit(16)?;
                self.pos += 1;
            }
            Some(v)
        }
        fn string(&mut self) -> Option<String> {
            self.take(b'"')?;
            let mut out = Vec::new();
            loop {
                let byte = *self.text.get(self.pos)?;
                self.pos += 1;
                match byte {
                    b'"' => return String::from_utf8(out).ok(),
                    b'\\' => {
                        let escape = *self.text.get(self.pos)?;
                        self.pos += 1;
                        match escape {
                            b'"' | b'\\' | b'/' => out.push(escape),
                            b'b' => out.push(8),
                            b'f' => out.push(12),
                            b'n' => out.push(10),
                            b'r' => out.push(13),
                            b't' => out.push(9),
                            b'u' => {
                                let mut cp = self.hex()?;
                                if (0xd800..=0xdbff).contains(&cp) {
                                    if self.text.get(self.pos..self.pos + 2)? != b"\\u" { return None; }
                                    self.pos += 2;
                                    let low = self.hex()?;
                                    if !(0xdc00..=0xdfff).contains(&low) { return None; }
                                    cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
                                }
                                let mut buf = [0; 4];
                                out.extend_from_slice(char::from_u32(cp)?.encode_utf8(&mut buf).as_bytes());
                            }
                            _ => return None,
                        }
                    }
                    0..=31 => return None,
                    _ => out.push(byte),
                }
            }
        }
        fn array(&mut self) -> Option<Vec<String>> {
            self.take(b'[')?;
            let mut out = Vec::new();
            self.ws();
            if self.text.get(self.pos) == Some(&b']') { self.pos += 1; } else {
                loop {
                    out.push(self.string()?);
                    self.ws();
                    if self.text.get(self.pos) == Some(&b']') {
                        self.pos += 1;
                        break;
                    }
                    self.take(b',')?;
                }
            }
            self.ws();
            if self.pos != self.text.len() { return None; }
            Some(out)
        }
    }
    fn quote(text: &str) -> String {
        let mut out = String::from("\"");
        for ch in text.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                ch if ch < ' ' => out.push_str(&format!("\\u{:04x}", ch as u32)),
                ch => out.push(ch),
            }
        }
        out.push('"');
        out
    }
    fn field<'a>(text: &'a str, wanted: &str) -> Option<&'a str> {
        let mut j = Json { text: text.as_bytes(), pos: 0 };
        j.take(b'{')?;
        loop {
            let key = j.string()?;
            j.take(b':')?;
            j.ws();
            let start = j.pos;
            if j.text.get(start) == Some(&b'"') {
                j.string()?;
            } else {
                let mut depth = 0;
                let mut quoted = false;
                let mut escaped = false;
                while let Some(&b) = j.text.get(j.pos) {
                    if !quoted && depth == 0 && matches!(b, b',' | b'}') {
                        break;
                    }
                    if quoted {
                        if escaped {
                            escaped = false;
                        } else if b == b'\\' {
                            escaped = true;
                        } else if b == b'"' {
                            quoted = false;
                        }
                    } else {
                        match b {
                            b'"' => quoted = true,
                            b'{' | b'[' => depth += 1,
                            b'}' | b']' => depth -= 1,
                            _ => {}
                        }
                    }
                    j.pos += 1;
                }
            }
            if key == wanted { return Some(text[start..j.pos].trim()); }
            j.take(b',')?;
        }
    }
    fn top_level_id(line: &str) -> Option<&str> {
        field(line, "id")
    }
    fn has_method(line: &str) -> bool {
        field(line, "method").is_some()
    }
    struct PipeHandle(usize);
    impl Drop for PipeHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0 as Handle); }
        }
    }
    struct PipeIo {
        handle: Arc<PipeHandle>,
        event: Handle,
    }
    impl PipeIo {
        fn new(handle: Arc<PipeHandle>) -> io::Result<Self> {
            let event = unsafe { CreateEventW(ptr::null(), 1, 0, ptr::null()) };
            if event.is_null() { return Err(io::Error::last_os_error()); }
            Ok(Self { handle, event })
        }
        fn transfer(&mut self, buffer: &mut [u8], write: bool) -> io::Result<usize> {
            let mut ov = Overlapped { internal: 0, internal_high: 0, offset: 0, offset_high: 0, event: self.event };
            let mut count = 0;
            unsafe {
                let ok = if write {
                    WriteFile(self.handle.0 as Handle, buffer.as_ptr(), buffer.len() as u32, &mut count, &mut ov)
                } else {
                    ReadFile(self.handle.0 as Handle, buffer.as_mut_ptr(), buffer.len() as u32, &mut count, &mut ov)
                };
                if ok == 0 {
                    let error = GetLastError();
                    if error == 109 || error == 232 { return Ok(0); }
                    if error != 997 { return Err(io::Error::from_raw_os_error(error as i32)); }
                    if GetOverlappedResult(self.handle.0 as Handle, &mut ov, &mut count, 1) == 0 {
                        let error = GetLastError();
                        if error == 109 || error == 232 { return Ok(0); }
                        return Err(io::Error::from_raw_os_error(error as i32));
                    }
                }
            }
            Ok(count as usize)
        }
        fn write_all(&mut self, mut bytes: &mut [u8]) -> io::Result<()> {
            while !bytes.is_empty() {
                let n = self.transfer(bytes, true)?;
                if n == 0 { return Err(io::ErrorKind::BrokenPipe.into()); }
                bytes = &mut bytes[n..];
            }
            Ok(())
        }
    }
    impl Drop for PipeIo {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.event);
            }
        }
    }
    const DOWN: &str = "cc core is not running; nothing was done. Try again once cc is open.";
    const RESTARTED: &str = "cc core restarted before answering; call again.";
    struct Connection {
        alive: bool,
        pending: HashSet<String>,
    }
    fn output(stdout: &Mutex<()>, line: &[u8]) {
        let _guard = stdout.lock().unwrap();
        let mut out = io::stdout().lock();
        let _ = out.write_all(line).and_then(|_| out.flush());
    }
    fn error(stdout: &Mutex<()>, id: &str, message: &str) {
        output(stdout, format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"error\":{{\"code\":-32603,\"message\":{}}}}}\n", quote(message)).as_bytes());
    }
    fn disconnected(state: &mut Connection, stdout: &Mutex<()>) {
        state.alive = false;
        for id in state.pending.drain() {
            error(stdout, &id, RESTARTED);
        }
    }
    fn connect(name: &[u16], hello: &[u8], stdout: Arc<Mutex<()>>) -> Option<(PipeIo, Arc<Mutex<Connection>>)> {
        let deadline = Instant::now() + Duration::from_secs(1);
        let handle = loop {
            let h = unsafe { CreateFileW(name.as_ptr(), 0xc0000000, 0, ptr::null(), 3, 0x40000000, ptr::null_mut()) };
            if h as isize != -1 { break h; }
            let remaining = deadline.saturating_duration_since(Instant::now()).as_millis() as u32;
            if unsafe { GetLastError() } != 231 || remaining == 0 || unsafe { WaitNamedPipeW(name.as_ptr(), remaining) } == 0 {
                return None;
            }
        };
        let handle = Arc::new(PipeHandle(handle as usize));
        let mut writer = PipeIo::new(handle.clone()).ok()?;
        writer.write_all(&mut hello.to_vec()).ok()?;
        let state = Arc::new(Mutex::new(Connection { alive: true, pending: HashSet::new() }));
        let reading = state.clone();
        // The reader owns its own overlapped event and emits complete lines only.
        thread::spawn(move || {
            let mut reader = match PipeIo::new(handle) {
                Ok(reader) => reader,
                Err(_) => { disconnected(&mut reading.lock().unwrap(), &stdout); return; }
            };
            let mut buf = [0; 8192];
            let mut buffered = Vec::new();
            loop {
                match reader.transfer(&mut buf, false) {
                    Ok(0) | Err(_) => {
                        disconnected(&mut reading.lock().unwrap(), &stdout);
                        return;
                    }
                    Ok(n) => {
                        buffered.extend_from_slice(&buf[..n]);
                        let mut start = 0;
                        while let Some(end) = buffered[start..].iter().position(|&b| b == b'\n').map(|i| start + i + 1) {
                            let line = &buffered[start..end];
                            let mut state = reading.lock().unwrap();
                            if !state.alive { return; }
                            if let Ok(text) = std::str::from_utf8(line) {
                                if let Some(id) = top_level_id(text) { state.pending.remove(id); }
                            }
                            output(&stdout, line);
                            start = end;
                        }
                        buffered.drain(..start);
                    }
                }
            }
        });
        Some((writer, state))
    }
    fn relay(server: &str) -> ! {
        let name: Vec<u16> = format!("\\\\.\\pipe\\{}", env::var("METATROOPER_PIPE_PREFIX").unwrap_or_else(|_| "metatrooper".into()))
            .encode_utf16().chain(Some(0)).collect();
        let hello = format!(
            "{{\"jsonrpc\":\"2.0\",\"method\":\"mcp.stdio\",\"params\":{{\"server\":{},\"session_id\":{},\"pid\":{}}}}}\n",
            quote(server), quote(&env::var("TROOP_SESSION_ID").unwrap_or_default()), process::id()
        ).into_bytes();
        let stdout = Arc::new(Mutex::new(()));
        let mut connection: Option<(PipeIo, Arc<Mutex<Connection>>)> = None;
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            if line.trim().is_empty() { continue; }
            let id = top_level_id(&line).filter(|_| has_method(&line));
            if connection.as_ref().map_or(true, |(_, state)| !state.lock().unwrap().alive) {
                connection = connect(&name, &hello, stdout.clone());
            }
            let Some((writer, state)) = connection.as_mut() else {
                if let Some(id) = id { error(&stdout, id, DOWN); }
                continue;
            };
            let mut state = state.lock().unwrap();
            if !state.alive {
                if let Some(id) = id { error(&stdout, id, DOWN); }
                continue;
            }
            if let Some(id) = id { state.pending.insert(id.to_owned()); }
            let mut bytes = format!("{line}\n").into_bytes();
            if writer.write_all(&mut bytes).is_err() {
                if let Some(id) = id {
                    state.pending.remove(id);
                    error(&stdout, id, DOWN);
                }
                disconnected(&mut state, &stdout);
            }
        }
        process::exit(0)
    }
    pub fn main() {
        let flags: Vec<String> = env::args().skip(1).collect();
        if flags.first().map(String::as_str) == Some("mcp") {
            if let Some(server) = flags.get(1).filter(|s| matches!(s.as_str(), "steps" | "ui" | "desktop" | "browser")) {
                relay(server);
            }
            process::exit(2);
        }
        let value = |key: &str| flags.chunks(2).find(|p| p[0] == key).and_then(|p| p.get(1)).map(String::as_str).unwrap_or("");
        let decoded = base64(value("--args-b64")).unwrap_or_default();
        let argv = Json { text: decoded.as_bytes(), pos: 0 }.array().filter(|a| !a.is_empty());
        let Some(argv) = argv else {
            eprintln!("troop launch: no command given");
            process::exit(2);
        };
        let _job = job();
        unsafe {
            SetConsoleCtrlHandler(Some(ctrl), 1);
        }
        let mut child = match Command::new(&argv[0]).args(&argv[1..]).env("TROOP_SESSION_ID", value("--session")).spawn() {
            Ok(child) => child,
            Err(error) => {
                if error.kind() == io::ErrorKind::NotFound {
                    eprintln!("troop launch: could not find {} on PATH", argv[0]);
                } else {
                    eprintln!("troop launch: could not start {}: {error}", argv[0]);
                }
                process::exit(127);
            }
        };
        process::exit(child.wait().ok().and_then(|s| s.code()).unwrap_or(1));
    }
}
