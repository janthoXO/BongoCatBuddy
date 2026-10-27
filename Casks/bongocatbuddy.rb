# Updated by .github/workflows/release.yml on every release.
cask "bongocatbuddy" do
  version "0.0.15"
  sha256 "4a039b9180bb8d97831e76d155064819c11beccdeecc7b87716c1e0e4028d84e"

  url "https://github.com/janthoXO/BongoCatBuddy/releases/download/v#{version}/BongoCatBuddy_#{version}_aarch64.dmg"
  name "BongoCatBuddy"
  desc "Desktop overlay companion for the Bongo Cat Steam game"
  homepage "https://github.com/janthoXO/BongoCatBuddy"

  depends_on arch: :arm64
  depends_on :macos

  app "BongoCatBuddy.app"

  # The app is only ad-hoc signed, so Gatekeeper would refuse to open it.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/BongoCatBuddy.app"],
        writable_paths: ["BongoCatBuddy.app"],
        writable_base:  :appdir
  end

  zap trash: [
    "~/Library/Application Support/com.bongocatbuddy.app",
    "~/Library/Caches/com.bongocatbuddy.app",
    "~/Library/WebKit/com.bongocatbuddy.app",
  ]
end
