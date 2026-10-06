import SwiftUI

/// Sign-in / sign-up screen shown when there's no session.
struct LoginView: View {
    @ObservedObject private var auth = Auth.shared
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focused: Field?

    enum Mode { case signIn, signUp }
    enum Field { case email, password }

    var body: some View {
        ZStack {
            // Brand backdrop
            Color(.systemGroupedBackground).ignoresSafeArea()
            LinearGradient(colors: [DS.brand.opacity(0.10), .clear],
                           startPoint: .top, endPoint: .center).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 60)
                    VStack(alignment: .leading, spacing: 18) {
                        HStack(spacing: 10) {
                            Image(systemName: "leaf.fill")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(LinearGradient(colors: [DS.brandLight, DS.brand], startPoint: .topLeading, endPoint: .bottomTrailing),
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            Text("PlantWatch").font(.system(size: 22, weight: .bold))
                        }
                        Text(mode == .signIn ? "Sign in to your garden" : "Create your account")
                            .font(.subheadline).foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 6) {
                            Text("EMAIL").font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                            TextField("you@example.com", text: $email)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textFieldStyle(.roundedBorder)
                                .focused($focused, equals: .email)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("PASSWORD").font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                            SecureField("••••••••", text: $password)
                                .textContentType(mode == .signIn ? .password : .newPassword)
                                .textFieldStyle(.roundedBorder)
                                .focused($focused, equals: .password)
                                .onSubmit(submit)
                        }

                        if let error {
                            Text(error).font(.footnote).foregroundStyle(DS.bad)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Button(action: submit) {
                            HStack {
                                if busy { ProgressView().tint(.white) }
                                Text(mode == .signIn ? "Sign in" : "Create account")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(DS.brand, in: RoundedRectangle(cornerRadius: 12))
                            .foregroundStyle(.white)
                        }
                        .buttonStyle(.plain)
                        .disabled(busy || email.isEmpty || password.count < 6)
                        .opacity((busy || email.isEmpty || password.count < 6) ? 0.6 : 1)

                        HStack(spacing: 4) {
                            Text(mode == .signIn ? "New here?" : "Already have an account?")
                                .foregroundStyle(.secondary)
                            Button(mode == .signIn ? "Create an account" : "Sign in") {
                                withAnimation { mode = mode == .signIn ? .signUp : .signIn; error = nil }
                            }
                            .foregroundStyle(DS.brand)
                        }
                        .font(.footnote)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                    }
                    .padding(24)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.separator.opacity(0.5)))
                    .padding(.horizontal, 20)
                    .frame(maxWidth: 440)
                    Spacer(minLength: 40)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func submit() {
        guard !busy else { return }
        error = nil; busy = true
        Task {
            do {
                if mode == .signIn {
                    try await auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
                } else {
                    let created = try await auth.signUp(email: email.trimmingCharacters(in: .whitespaces), password: password)
                    if !created {
                        error = "Check your email to confirm your account, then sign in."
                        mode = .signIn; busy = false; return
                    }
                }
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
