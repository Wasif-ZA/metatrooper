param([string]$Title = 'Troop test form', [int]$X = 40, [int]$Y = 40, [switch]$NoCaptcha)
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="360" Height="320" Topmost="True" WindowStartupLocation="Manual">
  <StackPanel Margin="12">
    <TextBlock Text="Name"/>
    <TextBox x:Name="FieldName" AutomationProperties.Name="Name"/>
    <TextBlock Text="Email"/>
    <TextBox x:Name="FieldEmail" AutomationProperties.Name="Email"/>
    <TextBlock Text="Postcode"/>
    <TextBox x:Name="FieldPostcode" AutomationProperties.Name="Postcode"/>
    <GroupBox x:Name="Captcha" Header="Captcha" Margin="0,10,0,0">
      <StackPanel Orientation="Horizontal">
        <TextBlock Text="Type the word: harbour" Margin="0,0,8,0"/>
        <TextBox x:Name="Answer" Width="120" AutomationProperties.Name="Captcha answer"/>
      </StackPanel>
    </GroupBox>
    <Button x:Name="Send" Content="Submit" Width="100" HorizontalAlignment="Left" Margin="0,10,0,0"/>
    <TextBlock x:Name="Status" Text="Not sent" Margin="0,8,0,0"/>
  </StackPanel>
</Window>
'@

$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$window.Title = $Title
if ($NoCaptcha) { $window.FindName('Captcha').Visibility = 'Collapsed' }
$window.Left = $X
$window.Top = $Y
$find = { param($n) $window.FindName($n) }
(& $find 'Send').Add_Click({
  if (-not $NoCaptcha -and (& $find 'Answer').Text -ne 'harbour') { (& $find 'Status').Text = 'Captcha wrong'; return }
  (& $find 'Status').Text = "Received: $((& $find 'FieldName').Text)"
})
$window.Add_SourceInitialized({
  $handle = (New-Object System.Windows.Interop.WindowInteropHelper $window).Handle
  [Console]::Out.WriteLine("handle=$handle")
  [Console]::Out.Flush()
})
[void]$window.ShowDialog()
