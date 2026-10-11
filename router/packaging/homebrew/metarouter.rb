class Metarouter < Formula
  include Language::Python::Virtualenv

  desc "Tool memory for coding agents: keep commands that worked, run them by name"
  homepage "https://github.com/Wasif-ZA/metatrooper/tree/main/router"
  url "https://files.pythonhosted.org/packages/source/m/metarouter/metarouter-0.1.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "python@3.12"

  def install
    virtualenv_install_with_resources
  end

  test do
    assert_match "exec", shell_output("#{bin}/metarouter --help")
  end
end
