import Foundation
import SwiftUI
import UserNotifications

/// Local-only preferences: per-plant moisture overrides + notification choices.
@MainActor
final class Preferences: ObservableObject {
    static let shared = Preferences()

    @Published var overrides:     [String: Override] = [:]
    @Published var nameOverrides: [String: String]  = [:]   // id → custom display name
    @Published var zoneOverrides: [String: String]  = [:]   // id → zone name
    @Published var zoneOrder:     [String: [String]] = [:]  // zone → [id, id, ...] custom drag order
    @Published var notifyMode:    NotifyMode         = .off
    @Published var notifyOffline: Bool               = false
    @Published var notifyPlants:  Set<String>        = []
    @Published var lastStatus:    [String: String]   = [:]

    static let zones = ["Back Yard", "Side Yards", "Front Yard"]

    struct Override: Codable, Hashable {
        let low: Int
        let high: Int
    }

    enum NotifyMode: String, CaseIterable, Identifiable, Codable {
        case off, dry, wet, both
        var id: String { rawValue }
        var label: String {
            switch self {
            case .off:  return "Off"
            case .dry:  return "Only when too dry"
            case .wet:  return "Only when too wet"
            case .both: return "Both dry and too wet"
            }
        }
    }

    private let kOverrides     = "pw-overrides"
    private let kNames         = "pw-name-overrides"
    private let kZones         = "pw-zone-overrides"
    private let kOrder         = "pw-order"
    private let kNotifyMode    = "pw-notify-mode"
    private let kNotifyOffline = "pw-notify-offline"
    private let kNotifyPlants  = "pw-notify-plants"
    private let kLastStatus    = "pw-last-status"

    private init() { load() }

    private func load() {
        let d = UserDefaults.standard
        if let data = d.data(forKey: kOverrides),
           let m = try? JSONDecoder().decode([String: Override].self, from: data) { overrides = m }
        if let data = d.data(forKey: kNames),
           let m = try? JSONDecoder().decode([String: String].self, from: data) { nameOverrides = m }
        if let data = d.data(forKey: kZones),
           let m = try? JSONDecoder().decode([String: String].self, from: data) { zoneOverrides = m }
        if let data = d.data(forKey: kOrder),
           let m = try? JSONDecoder().decode([String: [String]].self, from: data) { zoneOrder = m }
        if let raw = d.string(forKey: kNotifyMode), let m = NotifyMode(rawValue: raw) { notifyMode = m }
        notifyOffline = d.bool(forKey: kNotifyOffline)
        if let arr = d.array(forKey: kNotifyPlants) as? [String] { notifyPlants = Set(arr) }
        if let data = d.data(forKey: kLastStatus),
           let m = try? JSONDecoder().decode([String: String].self, from: data) { lastStatus = m }
    }

    private func saveOverrides()    { if let d = try? JSONEncoder().encode(overrides)     { UserDefaults.standard.set(d, forKey: kOverrides) } }
    private func saveZones()        { if let d = try? JSONEncoder().encode(zoneOverrides) { UserDefaults.standard.set(d, forKey: kZones) } }
    private func saveNotifyPlants() { UserDefaults.standard.set(Array(notifyPlants), forKey: kNotifyPlants) }
    private func saveLastStatus()   { if let d = try? JSONEncoder().encode(lastStatus) { UserDefaults.standard.set(d, forKey: kLastStatus) } }

    func setOverride(_ id: String, low: Int, high: Int) {
        overrides[id] = Override(low: low, high: high)
        saveOverrides()
    }
    func clearOverride(_ id: String) {
        overrides.removeValue(forKey: id)
        saveOverrides()
    }
    private func saveNames() { if let d = try? JSONEncoder().encode(nameOverrides) { UserDefaults.standard.set(d, forKey: kNames) } }
    func setName(_ id: String, _ name: String) { nameOverrides[id] = name; saveNames() }
    func clearName(_ id: String) { nameOverrides.removeValue(forKey: id); saveNames() }
    /// Move a plant to a different physical zone (or clear by passing its server default elsewhere).
    func setZone(_ id: String, _ zone: String) {
        zoneOverrides[id] = zone
        saveZones()
    }
    func clearZone(_ id: String) {
        zoneOverrides.removeValue(forKey: id)
        saveZones()
    }

    private func saveOrder() { if let d = try? JSONEncoder().encode(zoneOrder) { UserDefaults.standard.set(d, forKey: kOrder) } }

    /// Sort key for a plant id within its zone (unlisted → large).
    func orderIndex(_ zone: String, _ id: String) -> Int {
        guard let arr = zoneOrder[zone], let i = arr.firstIndex(of: id) else { return Int.max }
        return i
    }

    /// Home (gateway) zone for a plant id like "Garden hub-4".
    private func homeZone(_ id: String) -> String {
        if let r = id.range(of: "-", options: .backwards) { return String(id[..<r.lowerBound]) }
        return id
    }

    /// Drop `dragged` onto `target` (which lives in `targetZone`). Handles both
    /// in-section reorder and cross-section move (sets/clears the zone override).
    func dropOnCard(dragged: String, targetZone: String, target: String, targetZoneIds: [String]) {
        guard dragged != target else { return }
        // Cross-section move → set/clear zone override.
        if targetZone == homeZone(dragged) { zoneOverrides.removeValue(forKey: dragged) }
        else { zoneOverrides[dragged] = targetZone }
        saveZones()
        // Drop `dragged` out of every existing order list…
        for (z, var arr) in zoneOrder { arr.removeAll { $0 == dragged }; zoneOrder[z] = arr }
        // …and place it right before `target` in the destination order.
        var ids = targetZoneIds.filter { $0 != dragged }
        if let ti = ids.firstIndex(of: target) { ids.insert(dragged, at: ti) } else { ids.append(dragged) }
        zoneOrder[targetZone] = ids
        saveOrder()
    }
    func setNotifyOn(_ id: String, _ on: Bool) {
        if on { notifyPlants.insert(id) } else { notifyPlants.remove(id) }
        saveNotifyPlants()
    }
    func setNotifyMode(_ mode: NotifyMode) {
        notifyMode = mode
        UserDefaults.standard.set(mode.rawValue, forKey: kNotifyMode)
    }
    func setNotifyOffline(_ on: Bool) {
        notifyOffline = on
        UserDefaults.standard.set(on, forKey: kNotifyOffline)
    }
    func isNotifyOn(_ id: String) -> Bool { notifyPlants.contains(id) }

    /// Classify a moisture value against a low/high band.
    private func classify(_ m: Double, low: Int, high: Int) -> (Status, String, Bool) {
        if m < Double(low) {
            let gap = Double(low) - m
            return gap >= 12 ? (.veryDry, "VERY DRY", true) : (.dry, "Dry", true)
        }
        if m > Double(high) { return (.tooWet, "Too wet", false) }
        return (.good, "Good", false)
    }

    /// Apply local range + zone overrides to a reading.
    func applyOverride(_ r: Reading) -> Reading {
        let id = "\(r.zone)-\(r.channel)"
        var out = r

        // Custom display name.
        if let nm = nameOverrides[id], nm != r.name {
            out.name = nm
            out.customName = true
        }

        // Zone override — move the plant to a different physical zone.
        if let z = zoneOverrides[id], z != (r.physicalZone ?? r.zone) {
            out.physicalZone = z
            out.customZone = true
        }

        // Range override — recompute status against the new band.
        if let o = overrides[id] {
            if let m = r.moisture {
                let (status, headline, _) = classify(m, low: o.low, high: o.high)
                out.idealLow = o.low; out.idealHigh = o.high
                out.status = status; out.headline = headline
                out.needsWater = (status == .dry || status == .veryDry)
                out.customRange = true
            } else {
                out.idealLow = o.low; out.idealHigh = o.high; out.customRange = true
            }
        }
        return out
    }

    /// Fire local notifications when a watched plant's status worsens or it goes
    /// offline, respecting prefs.
    func notifyIfChanged(_ readings: [Reading]) {
        guard notifyMode != .off || notifyOffline else { return }
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

            var newStatus: [String: String] = [:]
            for r in readings {
                let id = "\(r.zone)-\(r.channel)"
                newStatus[id] = r.status.rawValue
                guard notifyPlants.contains(id) else { continue }
                let prev = lastStatus[id]
                // Don't fire on first sighting or unchanged status.
                guard let prev, prev != r.status.rawValue else { continue }

                let content = UNMutableNotificationContent()
                content.sound = .default
                var fire = false

                if notifyOffline && r.status == .noReading && prev != Status.noReading.rawValue {
                    content.title = "📡 \(r.name) went offline"
                    content.body  = r.lastSeenRelative.map { "Last reported \($0)." } ?? "Sensor stopped reporting."
                    fire = true
                } else if let m = r.moisture {
                    let becameDry = (r.status == .dry || r.status == .veryDry) &&
                                    (prev != Status.dry.rawValue && prev != Status.veryDry.rawValue)
                    let becameWet = r.status == .tooWet && prev != Status.tooWet.rawValue
                    let fireDry = (notifyMode == .dry || notifyMode == .both) && becameDry
                    let fireWet = (notifyMode == .wet || notifyMode == .both) && becameWet
                    if fireDry || fireWet {
                        let bandText = (r.idealLow != nil && r.idealHigh != nil) ? " (ideal \(r.idealLow!)–\(r.idealHigh!)%)" : ""
                        content.title = "🌱 \(r.name)"
                        content.body  = "\(r.headline) · \(Int(m))%\(bandText)"
                        fire = true
                    }
                }
                guard fire else { continue }
                let req = UNNotificationRequest(identifier: id,
                                                content: content,
                                                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
                try? await UNUserNotificationCenter.current().add(req)
            }
            await MainActor.run {
                lastStatus = newStatus
                saveLastStatus()
            }
        }
    }

    /// Request notification authorization from the user.
    func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }
}

// MARK: – Reading helpers for overrides

extension Reading {
    func withOverride(low: Int, high: Int, status: Status, headline: String) -> Reading {
        var r = self
        r.idealLow = low
        r.idealHigh = high
        r.status = status
        r.headline = headline
        r.needsWater = (status == .dry || status == .veryDry)
        r.customRange = true
        return r
    }
    func withRange(low: Int, high: Int, customRange: Bool) -> Reading {
        var r = self
        r.idealLow = low
        r.idealHigh = high
        r.customRange = customRange
        return r
    }
}
