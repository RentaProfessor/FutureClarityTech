import SwiftUI
import UserNotifications

/// Physical-zone filter applied on the dashboard.
enum ZoneFilter: String, CaseIterable, Identifiable {
    case all        = "All"
    case backYard   = "Back Yard"
    case sideYards  = "Side Yards"
    case frontYard  = "Front Yard"
    var id: String { rawValue }
}

enum LayoutMode: String, CaseIterable, Identifiable {
    case grid = "Grid"
    case list = "List"
    var id: String { rawValue }
}

struct ContentView: View {
    @StateObject private var svc = PlantReportService()
    @StateObject private var prefs = Preferences.shared
    @State private var nowTick = Date()
    @State private var filter: ZoneFilter = .all
    @AppStorage("pw-layout") private var layoutRaw: String = LayoutMode.grid.rawValue
    @State private var infoReading: Reading?    // currently presented in the sheet
    @State private var settingsOpen = false
    private var layout: LayoutMode {
        get { LayoutMode(rawValue: layoutRaw) ?? .grid }
    }
    private let tickTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground).ignoresSafeArea()

                Group {
                    if svc.needsOnboarding {
                        OnboardingView(onDone: { Task { await svc.load() } })
                    } else if let raw = svc.report {
                        // Apply local prefs (range / zone) in the view so edits reflect instantly.
                        let report = raw.applying(prefs)
                        ReportScrollView(
                            report: report, lastLoaded: svc.lastLoaded, nowTick: nowTick,
                            filter: $filter, layoutRaw: $layoutRaw,
                            onInfoTap: { infoReading = $0 }
                        )
                    } else if svc.loading {
                        LoadingView()
                    } else if let err = svc.error {
                        ErrorView(message: err) {
                            Task { await svc.load() }
                        }
                    } else {
                        LoadingView()
                    }
                }
                .sheet(item: $infoReading) { reading in
                    InfoSheet(reading: reading)
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                }
            }
            .navigationTitle("PlantWatch")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 4) {
                        Button { settingsOpen = true } label: {
                            Image(systemName: "gear")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .accessibilityLabel("Notification settings")
                        RefreshButton(loading: svc.loading) {
                            Task { await svc.load() }
                        }
                    }
                }
            }
            .refreshable { await svc.load() }
        }
        .sheet(isPresented: $settingsOpen) {
            SettingsSheet().environmentObject(prefs)
                .presentationDetents([.medium])
        }
        .task {
            await svc.load()
            svc.startAutoRefresh()
        }
        .onReceive(tickTimer) { _ in nowTick = Date() }
    }
}

// MARK: – Report scroll view

private struct ReportScrollView: View {
    let report: PlantReport
    let lastLoaded: Date?
    let nowTick: Date
    @Binding var filter: ZoneFilter
    @Binding var layoutRaw: String
    let onInfoTap: (Reading) -> Void
    @ObservedObject private var prefs = Preferences.shared   // observe order/zone changes

    private func bucket(_ r: Reading) -> String { r.physicalZone ?? r.zone }

    private var zones: [(zone: String, readings: [Reading])] {
        let g = Dictionary(grouping: report.readings, by: bucket)
        // The filter chips only know three zone names. Zones with any other name
        // still render under "All", after the known ones, alphabetically.
        let known = ZoneFilter.allCases.filter { $0 != .all }.map(\.rawValue)
        let ordered = known + g.keys.filter { !known.contains($0) }.sorted()
        return ordered.compactMap { z in
            guard filter == .all || filter.rawValue == z else { return nil }
            return g[z].map { (zone: z, readings: $0.sorted { a, b in
                // Custom drag order first; unlisted fall back to gateway + display order.
                let ia = prefs.orderIndex(z, a.id), ib = prefs.orderIndex(z, b.id)
                if ia != ib { return ia < ib }
                if a.zone != b.zone { return a.zone < b.zone }
                return (a.displayOrder ?? a.channel) < (b.displayOrder ?? b.channel)
            })}
        }
    }

    private var zoneCounts: [ZoneFilter: Int] {
        let g = Dictionary(grouping: report.readings, by: bucket)
        return [
            .all:        report.readings.count,
            .backYard:   (g["Back Yard"]  ?? []).count,
            .sideYards:  (g["Side Yards"] ?? []).count,
            .frontYard:  (g["Front Yard"] ?? []).count,
        ]
    }

    private var layout: LayoutMode { LayoutMode(rawValue: layoutRaw) ?? .grid }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let t = lastLoaded {
                    Text("Updated \(t.relative(to: nowTick))")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .id(nowTick)        // re-render with fresh tick
                }

                HeroCardView(report: report)

                // On iPhone the chip row + layout toggle can crowd. Let the chips
                // scroll horizontally if needed; layout toggle stays anchored right.
                HStack(spacing: 12) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        ZoneFilterRow(filter: $filter, counts: zoneCounts)
                    }
                    LayoutToggle(layoutRaw: $layoutRaw)
                        .fixedSize()
                }

                ForEach(zones, id: \.zone) { group in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(group.zone.uppercased())
                                .font(.system(size: 12.5, weight: .semibold))
                                .tracking(1.5)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("\(group.readings.count) plant\(group.readings.count == 1 ? "" : "s")")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        .padding(.horizontal, 4)
                        .padding(.top, 8)

                        let ids = group.readings.map(\.id)
                        if layout == .grid {
                            // Adaptive: 1 col on iPhone, 2 col on iPad portrait, 3 col on iPad landscape.
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12)], spacing: 12) {
                                ForEach(group.readings) { r in
                                    reorderableCard(r, zone: group.zone, ids: ids)
                                }
                            }
                        } else {
                            LazyVStack(spacing: 10) {
                                ForEach(group.readings) { r in
                                    reorderableCard(r, zone: group.zone, ids: ids)
                                }
                            }
                        }
                    }
                }

                ForEach(report.pairNotes.sorted(by: { $0.key < $1.key }), id: \.key) { k, v in
                    PairNoteView(pairName: k, note: v)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 30)
        }
    }

    // A card that can be dragged onto another card in the same zone to reorder.
    @ViewBuilder
    private func reorderableCard(_ r: Reading, zone: String, ids: [String]) -> some View {
        PlantCardView(reading: r, onInfoTap: { onInfoTap(r) })
            .draggable(r.id) {
                // Drag preview
                PlantCardView(reading: r)
                    .frame(width: 300)
                    .opacity(0.9)
            }
            .dropDestination(for: String.self) { items, _ in
                guard let dragged = items.first, dragged != r.id else { return false }
                prefs.dropOnCard(dragged: dragged, targetZone: zone, target: r.id, targetZoneIds: ids)
                return true
            }
    }
}

// MARK: – Smaller pieces

/// Compact two-button segmented control for the layout mode.
private struct LayoutToggle: View {
    @Binding var layoutRaw: String
    private var layout: LayoutMode {
        get { LayoutMode(rawValue: layoutRaw) ?? .grid }
    }
    var body: some View {
        HStack(spacing: 2) {
            button(.grid, system: "square.grid.2x2")
            button(.list, system: "list.bullet")
        }
        .padding(3)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(.separator.opacity(0.5)))
    }
    private func button(_ m: LayoutMode, system: String) -> some View {
        let on = layout == m
        return Button { layoutRaw = m.rawValue } label: {
            Image(systemName: system)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 30, height: 24)
                .background(on ? AnyView(Capsule().fill(DS.brand)) : AnyView(Color.clear))
                .foregroundStyle(on ? Color.white : Color.secondary)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Sheet shown when the info (i) button is tapped on a card.
private struct InfoSheet: View {
    let reading: Reading
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var prefs = Preferences.shared
    @State private var lowDraft: Double = 0
    @State private var highDraft: Double = 0
    @State private var notifyOn: Bool = false
    @State private var nameDraft: String = ""
    private var plantId: String { "\(reading.zone)-\(reading.channel)" }
    /// The plant's home (gateway) zone — what clearing the override reverts to.
    private var serverZone: String { reading.zone }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                details
            }
            .padding(20)
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            lowDraft  = Double(reading.idealLow ?? 30)
            highDraft = Double(reading.idealHigh ?? 50)
            notifyOn  = prefs.isNotifyOn(plantId)
            nameDraft = reading.name
        }
    }

    // MARK: header
    private var header: some View {
        HStack(spacing: 12) {
            Text(DS.emoji(for: reading.name, type: reading.type))
                .font(.system(size: 36))
                .frame(width: 56, height: 56)
                .background(Color(.tertiarySystemGroupedBackground),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(reading.name).font(.title3.bold())
                if let lo = reading.idealLow, let hi = reading.idealHigh {
                    Text("CH\(reading.channel) · ideal \(lo)–\(hi)%")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Text("CH\(reading.channel) · \(reading.zone)")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(reading.headline.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(0.5)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .foregroundStyle(reading.status.tint)
                .background(reading.status.tint.opacity(0.16), in: Capsule())
        }
    }

    // MARK: details
    private var details: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Editable name + channel reference.
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("NAME").font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                    if reading.customName {
                        Text("CUSTOM").font(.system(size: 9, weight: .bold)).tracking(0.5)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(DS.brand.opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                            .foregroundStyle(DS.brand)
                    }
                    Spacer()
                    Text("CH\(reading.channel) · \(reading.zone)")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    TextField("Plant name", text: $nameDraft)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.done)
                        .onSubmit(saveName)
                    Button(action: saveName) {
                        Text("Save")
                            .font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(DS.brand, in: RoundedRectangle(cornerRadius: 9))
                            .foregroundStyle(.white)
                            .opacity(nameDraft.trimmingCharacters(in: .whitespaces) == reading.name ? 0.4 : 1)
                    }
                    .buttonStyle(.plain)
                    .disabled(nameDraft.trimmingCharacters(in: .whitespaces) == reading.name)
                }
                if reading.customName {
                    Button("Reset to default name") { prefs.clearName(plantId); dismiss() }
                        .font(.caption).foregroundStyle(DS.brandLight)
                }
            }

            // Location picker: move the plant to another zone.
            // Read the CURRENT zone live from prefs so the highlight updates on tap.
            let currentZone = prefs.zoneOverrides[plantId] ?? serverZone
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("LOCATION").font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                    if prefs.zoneOverrides[plantId] != nil {
                        Text("MOVED").font(.system(size: 9, weight: .bold)).tracking(0.5)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(DS.brand.opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                            .foregroundStyle(DS.brand)
                    }
                }
                HStack(spacing: 6) {
                    ForEach(Preferences.zones, id: \.self) { z in
                        let active = currentZone == z
                        Button {
                            if z == serverZone { prefs.clearZone(plantId) } else { prefs.setZone(plantId, z) }
                        } label: {
                            Text(z)
                                .font(.system(size: 12.5, weight: .medium))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(active ? AnyView(RoundedRectangle(cornerRadius: 9).fill(DS.brand))
                                                   : AnyView(RoundedRectangle(cornerRadius: 9).stroke(.separator)))
                                .foregroundStyle(active ? Color.white : Color(.label))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if reading.status == .noReading {
                let when = reading.lastSeenAbsolute.map { abs in
                    "Last reported \(abs)" + (reading.lastSeenRelative.map { " (\($0))" } ?? "") + "."
                } ?? "No recent reports found."
                let cause = reading.offlineCause
                    ?? "Battery state can't be read while it's offline, so the cause is unconfirmed — most likely a battery-contact or signal/range issue."
                sec("Sensor status", body: when + " " + cause)
            }
            if let why = reading.ratingExplanation, reading.status != .noReading { sec("Why this rating", body: why) }
            if let rec = reading.wateringRecommendation { sec("Suggested watering", body: rec) }
            else if reading.status == .good { sec("Suggested watering", body: "None — in range.") }

            if let note = reading.speciesNote {
                VStack(alignment: .leading, spacing: 4) {
                    Text("WHY \((reading.species ?? "this plant").uppercased()) NEEDS THIS RANGE")
                        .font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                    Text(note).font(.subheadline).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                    if let label = reading.sourceLabel, let urlStr = reading.sourceUrl, let url = URL(string: urlStr) {
                        Link(destination: url) {
                            HStack(spacing: 4) {
                                Image(systemName: "link").font(.system(size: 10, weight: .semibold))
                                Text("Source: \(label)").font(.caption)
                            }
                            .foregroundStyle(DS.brandLight).padding(.top, 2)
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("ADJUST IDEAL RANGE").font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                    if reading.customRange {
                        Text("CUSTOM").font(.system(size: 9, weight: .bold)).tracking(0.5)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(DS.brand.opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                            .foregroundStyle(DS.brand)
                    }
                }
                rangeSliders(showCustomBadge: true, resetButton: reading.customRange) { saveRange() }
            }

            // Per-plant notification toggle
            VStack(alignment: .leading, spacing: 6) {
                Text("ALERTS FOR THIS PLANT").font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
                Toggle(notifyOn ? "On" : "Off", isOn: $notifyOn)
                    .tint(DS.brand)
                    .onChange(of: notifyOn) { _, on in
                        Task { if on { _ = await prefs.requestAuthorization() }; prefs.setNotifyOn(plantId, on) }
                    }
                Group {
                    if prefs.notifyMode == .off { Text("Global notifications are off — enable them in the gear menu.") }
                    else { Text("Will alert when " + (prefs.notifyMode == .both ? "too dry or too wet" : prefs.notifyMode == .dry ? "too dry" : "too wet") + ".") }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func rangeSliders(showCustomBadge: Bool, resetButton: Bool, onChange: (() -> Void)? = nil) -> some View {
        HStack {
            Text("Low").font(.caption).foregroundStyle(.secondary).frame(width: 36, alignment: .leading)
            Slider(value: $lowDraft, in: 5...80, step: 1) { _ in onChange?() }
            Text("\(Int(lowDraft))%").font(.caption).monospacedDigit().frame(width: 40, alignment: .trailing)
        }
        HStack {
            Text("High").font(.caption).foregroundStyle(.secondary).frame(width: 36, alignment: .leading)
            Slider(value: $highDraft, in: 20...95, step: 1) { _ in onChange?() }
            Text("\(Int(highDraft))%").font(.caption).monospacedDigit().frame(width: 40, alignment: .trailing)
        }
        if resetButton {
            Button("Reset to species default") { prefs.clearOverride(plantId) }
                .font(.caption).foregroundStyle(DS.brandLight)
        }
    }

    private func saveName() {
        let v = nameDraft.trimmingCharacters(in: .whitespaces)
        if v.isEmpty { prefs.clearName(plantId) } else { prefs.setName(plantId, v) }
        dismiss()   // close so the renamed card is immediately visible (clear confirmation)
    }
    private func saveRange() {
        if lowDraft >= highDraft { lowDraft = highDraft - 1 }
        prefs.setOverride(plantId, low: Int(lowDraft), high: Int(highDraft))
    }
    private func sec(_ label: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
            Text(body).font(.subheadline).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private func titleCase(_ s: String) -> String {
    s.replacingOccurrences(of: "-", with: " ")
     .replacingOccurrences(of: "_", with: " ")
     .split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
}

/// Horizontal pill row to filter the report by physical zone.
private struct ZoneFilterRow: View {
    @Binding var filter: ZoneFilter
    let counts: [ZoneFilter: Int]
    // Hide the Front Yard chip when it has no plants.
    private var visibleZones: [ZoneFilter] {
        ZoneFilter.allCases.filter { z in
            z == .all || z == .backYard || z == .sideYards || (counts[z] ?? 0) > 0
        }
    }
    var body: some View {
        HStack(spacing: 8) {
            ForEach(visibleZones) { z in
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { filter = z }
                } label: {
                    HStack(spacing: 8) {
                        Text(z.rawValue)
                            .font(.system(size: 13.5, weight: .medium))
                        Text("\(counts[z] ?? 0)")
                            .font(.system(size: 11, weight: .semibold))
                            .monospacedDigit()
                            .padding(.horizontal, 7).padding(.vertical, 1)
                            .background(
                                (filter == z ? Color.white.opacity(0.22) : Color(.tertiarySystemGroupedBackground)),
                                in: Capsule()
                            )
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(
                        filter == z
                          ? AnyView(Capsule().fill(DS.brand))
                          : AnyView(Capsule().fill(Color(.secondarySystemGroupedBackground)).overlay(Capsule().stroke(.separator.opacity(0.5))))
                    )
                    .foregroundStyle(filter == z ? Color.white : Color(.label))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }
}

private struct RefreshButton: View {
    let loading: Bool
    let action: () -> Void
    @State private var rot: Double = 0

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 16, weight: .semibold))
                .rotationEffect(.degrees(rot))
                .animation(loading ? .linear(duration: 0.8).repeatForever(autoreverses: false)
                                   : .default, value: rot)
        }
        .disabled(loading)
        .onChange(of: loading) { _, l in rot = l ? rot + 360 : 0 }
    }
}

private struct PairNoteView: View {
    let pairName: String
    let note: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("🥑").font(.system(size: 22))
            VStack(alignment: .leading, spacing: 2) {
                Text("\(pairName.capitalized) probe pair")
                    .font(.system(size: 13, weight: .semibold))
                Text(note)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DS.cardRadius, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .foregroundStyle(.separator)
        )
    }
}

private struct LoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large).tint(DS.brand)
            Text("Fetching latest readings…")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 36))
                .foregroundStyle(DS.bad.opacity(0.8))
            Text("Couldn't load the report")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
            Button("Try again", action: onRetry)
                .buttonStyle(.borderedProminent)
                .tint(DS.brand)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Global notification settings sheet (gear icon in toolbar).
private struct SettingsSheet: View {
    @EnvironmentObject private var prefs: Preferences
    @Environment(\.dismiss) private var dismiss
    @State private var authStatus: UNAuthorizationStatus = .notDetermined

    var body: some View {
        NavigationStack {
            Form {
                Section("When to alert") {
                    ForEach(Preferences.NotifyMode.allCases) { mode in
                        Button {
                            Task {
                                if mode != .off { _ = await prefs.requestAuthorization() }
                                prefs.setNotifyMode(mode)
                                await refreshAuth()
                            }
                        } label: {
                            HStack {
                                Text(mode.label).foregroundStyle(.primary)
                                Spacer()
                                if prefs.notifyMode == mode {
                                    Image(systemName: "checkmark").foregroundStyle(DS.brand)
                                }
                            }
                        }
                    }
                }
                Section("Sensor health") {
                    Toggle("Notify when a sensor goes offline", isOn: Binding(
                        get: { prefs.notifyOffline },
                        set: { on in Task { if on { _ = await prefs.requestAuthorization() }; prefs.setNotifyOffline(on); await refreshAuth() } }
                    ))
                    .tint(DS.brand)
                }
                Section {
                    HStack {
                        Text("Notification permission")
                        Spacer()
                        Text(authLabel).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Per-plant toggles live in each plant's info panel — tap the ⓘ on a card. Alerts fire when the app is open or recently active.")
                }
                Section("Account") {
                    if let e = Auth.shared.email {
                        HStack { Text("Signed in as"); Spacer(); Text(e).foregroundStyle(.secondary) }
                    }
                    Button(role: .destructive) { Auth.shared.signOut(); dismiss() } label: {
                        Text("Sign out")
                    }
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { await refreshAuth() }
    }

    private var authLabel: String {
        switch authStatus {
        case .authorized:    return "Granted"
        case .denied:        return "Denied — enable in iOS Settings"
        case .provisional:   return "Provisional"
        case .notDetermined: return "Not requested yet"
        case .ephemeral:     return "Ephemeral"
        @unknown default:    return "Unknown"
        }
    }
    @MainActor
    private func refreshAuth() async {
        authStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}

#Preview {
    ContentView()
}
