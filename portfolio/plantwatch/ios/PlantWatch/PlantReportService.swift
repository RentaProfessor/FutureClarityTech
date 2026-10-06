import Foundation
import Combine

@MainActor
final class PlantReportService: ObservableObject {
    @Published private(set) var report:  PlantReport?
    @Published private(set) var error:   String?
    @Published private(set) var loading: Bool = false
    @Published private(set) var lastLoaded: Date?
    /// True when the signed-in user has no sensors configured yet.
    @Published private(set) var needsOnboarding = false

    private var refreshTask: Task<Void, Never>?

    func load(silent: Bool = false) async {
        if !silent { loading = true }
        defer { loading = false }
        do {
            guard let token = await Auth.shared.accessToken() else {
                // The token could not be refreshed. Auth signs out when Supabase rejects
                // the session; if we are still signed in, the device is offline.
                if Auth.shared.isAuthed { self.error = "Can't reach the server. Check your connection." }
                return
            }
            var req = URLRequest(url: Config.endpoint)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            req.setValue(Config.supabaseAnonKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 500
            if status == 401 { Auth.shared.signOut(); return }
            guard status == 200 else { throw URLError(.badServerResponse) }

            // New user with no plants yet.
            if let probe = try? JSONDecoder().decode(OnboardProbe.self, from: data), probe.needs_onboarding == true {
                self.needsOnboarding = true; self.error = nil; return
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let parsed = try decoder.decode(PlantReport.self, from: data)
            self.report = parsed
            self.error = nil
            self.lastLoaded = Date()
            self.needsOnboarding = false
            Preferences.shared.notifyIfChanged(parsed.applying(Preferences.shared).readings)
        } catch {
            self.error = humanize(error)
            if self.report == nil { /* preserve previous data on transient failures */ }
        }
    }

    private struct OnboardProbe: Decodable { let needs_onboarding: Bool? }

    func startAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Config.autoRefreshInterval * 1_000_000_000))
                await self?.load(silent: true)
            }
        }
    }

    func stopAutoRefresh() { refreshTask?.cancel() }

    private func humanize(_ error: Error) -> String {
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet: return "No internet connection."
            case .timedOut:               return "Connection timed out — try again."
            case .badServerResponse:      return "Backend isn't responding correctly."
            default:                      return e.localizedDescription
            }
        }
        return error.localizedDescription
    }
}
