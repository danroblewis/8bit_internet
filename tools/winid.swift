// Prints "<windowID> <ownerPID> <title>" for on-screen windows owned by the given PID (or all Chrome windows).
import CoreGraphics
import Foundation
let pidFilter = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) : nil
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let h = b["Height"] as? Double ?? 0
  if layer != 0 || h < 300 { continue }
  if let pf = pidFilter { if pid != pf { continue } } else if !owner.contains("Chrome") { continue }
  print(w[kCGWindowNumber as String] as? Int ?? 0, pid, w[kCGWindowName as String] as? String ?? "")
}
