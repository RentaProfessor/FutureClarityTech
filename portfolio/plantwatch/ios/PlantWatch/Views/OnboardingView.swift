import SwiftUI

// Plant types the user can pick during setup (keys must match the backend catalog).
let SPECIES_OPTIONS: [(key: String, label: String)] = [
    ("citrus", "Citrus (orange, lemon, lime…)"),
    ("avocado", "Avocado"),
    ("camellia", "Camellia"),
    ("hydrangea", "Hydrangea"),
    ("rosemary", "Rosemary"),
    ("lavender", "Lavender"),
    ("westringia", "Westringia (coast rosemary)"),
    ("bay_laurel", "Bay Laurel"),
    ("star_jasmine", "Star Jasmine"),
    ("boxwood", "Boxwood"),
    ("convolvulus", "Convolvulus (silverbush)"),
    ("unknown", "Other / not sure"),
]

fileprivate struct DiscoveredChannel: Decodable, Identifiable {
    let channel: Int; let moisture: Double?; let battery: Double?
    var id: Int { channel }
}
fileprivate struct DiscoveredGateway: Decodable, Identifiable {
    let mac: String; let name: String; let station_type: String?
    let latitude: Double?; let longitude: Double?
    let channels: [DiscoveredChannel]
    var id: String { mac }
}
fileprivate struct DevicesResponse: Decodable { let gateways: [DiscoveredGateway]?; let error: String? }

struct PlantDraft: Identifiable {
    let id = UUID()
    let mac: String
    let gatewayName: String
    let channel: Int
    let moisture: Double?
    var name: String
    var species: String
    var zone: String
}

@MainActor
final class OnboardingModel: ObservableObject {
    enum Step { case connect, organize }
    @Published var step: Step = .connect
    @Published var appKey = ""
    @Published var apiKey = ""
    @Published var error: String?
    @Published var busy = false
    @Published fileprivate private(set) var gateways: [DiscoveredGateway] = []
    @Published var drafts: [PlantDraft] = []

    func discover() async {
        error = nil; busy = true; defer { busy = false }
        do {
            let data = try await Auth.shared.authed("functions/v1/ecowitt-devices", method: "POST",
                json: ["app_key": appKey.trimmingCharacters(in: .whitespaces),
                       "api_key": apiKey.trimmingCharacters(in: .whitespaces), "save": true])
            let resp = try JSONDecoder().decode(DevicesResponse.self, from: data)
            if let e = resp.error { throw Auth.AuthError.message(e) }
            let gws = resp.gateways ?? []
            if gws.isEmpty { throw Auth.AuthError.message("No devices found on that Ecowitt account.") }
            gateways = gws
            drafts = gws.flatMap { g in g.channels.map { c in
                PlantDraft(mac: g.mac, gatewayName: g.name, channel: c.channel, moisture: c.moisture,
                           name: "", species: "unknown", zone: g.name)
            }}
            step = .organize
        } catch { self.error = error.localizedDescription }
    }

    func finish(onDone: @escaping () -> Void) async {
        error = nil; busy = true; defer { busy = false }
        do {
            guard let uid = Auth.shared.userId else { throw Auth.AuthError.message("Not signed in") }

            // 1) Zones (unique names)
            var zoneNames: [String] = []
            for d in drafts { let z = d.zone.trimmingCharacters(in: .whitespaces); let n = z.isEmpty ? "My Garden" : z; if !zoneNames.contains(n) { zoneNames.append(n) } }
            let zoneBody = zoneNames.enumerated().map { ["user_id": uid, "name": $0.element, "sort": $0.offset] as [String: Any] }
            let zoneData = try await Auth.shared.authed("rest/v1/zones?select=id,name", method: "POST",
                json: zoneBody, prefer: "return=representation")
            let zones = try JSONSerialization.jsonObject(with: zoneData) as? [[String: Any]] ?? []
            var zoneId: [String: Int] = [:]
            for z in zones { if let n = z["name"] as? String, let i = z["id"] as? Int { zoneId[n] = i } }

            // 2) Gateways
            let gwBody = gateways.map { ["user_id": uid, "mac": $0.mac, "name": $0.name, "station_type": $0.station_type ?? ""] as [String: Any] }
            let gwData = try await Auth.shared.authed("rest/v1/gateways?select=id,mac", method: "POST",
                json: gwBody, prefer: "return=representation,resolution=merge-duplicates")
            let gws = try JSONSerialization.jsonObject(with: gwData) as? [[String: Any]] ?? []
            var gwId: [String: Int] = [:]
            for g in gws { if let m = g["mac"] as? String, let i = g["id"] as? Int { gwId[m] = i } }

            // 3) Plants
            var order = 0
            let plantBody: [[String: Any]] = drafts.map { d in
                order += 1
                let nm = d.name.trimmingCharacters(in: .whitespaces)
                let zn = d.zone.trimmingCharacters(in: .whitespaces)
                var row: [String: Any] = [
                    "user_id": uid, "gateway_id": gwId[d.mac] as Any, "channel": d.channel,
                    "name": nm.isEmpty ? "CH\(d.channel)" : nm, "species": d.species, "display_order": order,
                ]
                if let zid = zoneId[zn.isEmpty ? "My Garden" : zn] { row["zone_id"] = zid }
                return row
            }
            if !plantBody.isEmpty {
                _ = try await Auth.shared.authed("rest/v1/plants", method: "POST",
                    json: plantBody, prefer: "resolution=merge-duplicates,return=minimal")
            }

            // 4) Mark onboarded
            _ = try await Auth.shared.authed("rest/v1/profiles?id=eq.\(uid)", method: "PATCH",
                json: ["onboarded": true], prefer: "return=minimal")

            onDone()
        } catch { self.error = error.localizedDescription }
    }
}

struct OnboardingView: View {
    let onDone: () -> Void
    @StateObject private var model = OnboardingModel()

    var body: some View {
        NavigationStack {
            Group {
                switch model.step {
                case .connect:  connectStep
                case .organize: organizeStep
                }
            }
            .navigationTitle("Set up your garden")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Sign out") { Auth.shared.signOut() } } }
        }
    }

    // Step 1 — Ecowitt keys
    private var connectStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Enter the Application Key and API Key from your ecowitt.net account. PlantWatch uses them to discover your gateways and soil sensors.")
                    .font(.subheadline).foregroundStyle(.secondary)
                field("APPLICATION KEY", text: $model.appKey, placeholder: "Ecowitt Application Key")
                field("API KEY", text: $model.apiKey, placeholder: "Ecowitt API Key")
                if let e = model.error { Text(e).font(.footnote).foregroundStyle(DS.bad).fixedSize(horizontal: false, vertical: true) }
                Button { Task { await model.discover() } } label: {
                    HStack { if model.busy { ProgressView().tint(.white) }; Text("Discover my devices").font(.system(size: 16, weight: .semibold)) }
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(DS.brand, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(model.busy || model.appKey.isEmpty || model.apiKey.isEmpty)
                .opacity((model.busy || model.appKey.isEmpty || model.apiKey.isEmpty) ? 0.6 : 1)
            }
            .padding(20)
        }
    }

    // Step 2 — organize each channel
    private var organizeStep: some View {
        VStack(spacing: 0) {
            Form {
                Section { Text("Name each plant, pick its type, and set its zone. You can change all of this later.").font(.footnote).foregroundStyle(.secondary) }
                ForEach(model.gateways) { gw in
                    Section(gw.name) {
                        ForEach(model.drafts.indices.filter { model.drafts[$0].mac == gw.mac }, id: \.self) { i in
                            VStack(alignment: .leading, spacing: 8) {
                                Text("CH\(model.drafts[i].channel)\(model.drafts[i].moisture != nil ? " · \(Int(model.drafts[i].moisture!))%" : "")")
                                    .font(.caption).foregroundStyle(.secondary)
                                TextField("Plant name", text: $model.drafts[i].name).textFieldStyle(.roundedBorder)
                                Picker("Type", selection: $model.drafts[i].species) {
                                    ForEach(SPECIES_OPTIONS, id: \.key) { Text($0.label).tag($0.key) }
                                }
                                TextField("Zone", text: $model.drafts[i].zone).textFieldStyle(.roundedBorder)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                if let e = model.error { Section { Text(e).font(.footnote).foregroundStyle(DS.bad) } }
            }
            Button { Task { await model.finish(onDone: onDone) } } label: {
                HStack { if model.busy { ProgressView().tint(.white) }; Text("Finish setup").font(.system(size: 16, weight: .semibold)) }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(DS.brand, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(.white)
            }
            .buttonStyle(.plain).disabled(model.busy)
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled().textInputAutocapitalization(.never)
        }
    }
}
