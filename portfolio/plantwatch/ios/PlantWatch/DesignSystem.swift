import SwiftUI

/// Centralized colors, spacing, and helpers so every view uses the same tokens.
enum DS {

    // MARK: – Brand
    static let brand        = Color(red: 0.106, green: 0.302, blue: 0.243)   // #1B4D3E
    static let brandLight   = Color(red: 0.176, green: 0.416, blue: 0.310)   // #2D6A4F
    static let brandAccent  = Color(red: 0.424, green: 0.773, blue: 0.624)   // #6CC59F

    // MARK: – Status
    static let good = Color(red: 0.086, green: 0.475, blue: 0.302)
    static let warn = Color(red: 0.714, green: 0.459, blue: 0.000)
    static let bad  = Color(red: 0.702, green: 0.149, blue: 0.118)
    static let info = Color(red: 0.114, green: 0.373, blue: 0.722)

    // MARK: – Spacing
    static let cardRadius:  CGFloat = 16
    static let heroRadius:  CGFloat = 22
    static let spacing:     CGFloat = 12
    static let pad:         CGFloat = 16

    // MARK: – Plant emoji
    static func emoji(for name: String, type: String) -> String {
        let n = name.lowercased()
        if n.contains("lemon")                                      { return "🍋" }
        if n.contains("lime")                                       { return "🍐" }
        if n.contains("grapefruit")                                 { return "🍈" }
        if n.contains("tangerine") || n.contains("mandarin")
            || n.contains("orange")                                 { return "🍊" }
        if n.contains("avocado")                                    { return "🥑" }
        if n.contains("hydrangea")                                  { return "💐" }
        if n.contains("camelia") || n.contains("camellia")
            || n.contains("jasmine")                                { return "🌸" }
        if n.contains("rosemary")                                   { return "🌿" }
        if n.contains("lavender")                                   { return "💜" }
        if n.contains("westringia")                                 { return "🌾" }
        if n.contains("bay laurel") || n.contains("boxwood")        { return "🌳" }
        if n.contains("convolvulus")                                { return "🌱" }
        switch type {
        case "citrus":         return "🍊"
        case "avocado":        return "🥑"
        case "mediterranean":  return "🌿"
        case "broadleaf":      return "🌸"
        case "hydrangea":      return "💐"
        case "boxwood":        return "🌳"
        case "groundcover":    return "🌱"
        default:               return "🪴"
        }
    }
}

/// Status helpers
extension Status {
    var tint: Color {
        switch self {
        case .good:                 return DS.good
        case .goodHotWarning:       return DS.warn
        case .dry, .veryDry:        return DS.bad
        case .dryRainComing:        return DS.warn
        case .tooWet:               return DS.info
        case .noReading:            return .gray
        case .unassigned:           return Color(red: 0.54, green: 0.39, blue: 0.82)  // purple
        }
    }

    var stripeOpacity: Double {
        self == .noReading ? 0.4 : 1.0
    }
}

extension Date {
    func relative(to now: Date = Date()) -> String {
        let s = Int(now.timeIntervalSince(self))
        if s < 6   { return "just now" }
        if s < 60  { return "\(s) seconds ago" }
        let m = s / 60
        if m < 60  { return "\(m) minute\(m == 1 ? "" : "s") ago" }
        let h = m / 60
        if h < 24  { return "\(h) hour\(h == 1 ? "" : "s") ago" }
        let df = DateFormatter(); df.dateStyle = .medium
        return df.string(from: self)
    }
}
