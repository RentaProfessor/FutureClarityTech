import SwiftUI

@main
struct PlantWatchApp: App {
    @StateObject private var auth = Auth.shared

    var body: some Scene {
        WindowGroup {
            // Gate the app on authentication: show the login screen until the
            // user signs in; sessions persist so they stay logged in.
            if auth.isAuthed {
                ContentView()
            } else {
                LoginView()
            }
        }
    }
}
