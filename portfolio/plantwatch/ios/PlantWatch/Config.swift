import Foundation

/// Backend configuration for the PlantWatch iOS client.
///
/// The Supabase URL and anon key are not stored in source. Xcode copies them
/// from `Config.xcconfig` / `Secrets.xcconfig` into Info.plist at build time,
/// and they are read from the bundle here.
enum Config {
    static let supabaseUrl: String = infoValue("SupabaseURL")
    static let supabaseAnonKey: String = infoValue("SupabaseAnonKey")

    /// Authenticated per-user report (requires sign-in).
    static let endpoint = URL(string: "\(supabaseUrl)/functions/v1/report-v2")!

    /// Auto-refresh while the app is foregrounded.
    static let autoRefreshInterval: TimeInterval = 60

    private static func infoValue(_ key: String) -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !raw.isEmpty else {
            fatalError("\(key) is missing from Info.plist. Copy ios/Secrets.example.xcconfig to ios/Secrets.xcconfig and fill in your Supabase project.")
        }
        return raw.hasSuffix("/") ? String(raw.dropLast()) : raw
    }
}
