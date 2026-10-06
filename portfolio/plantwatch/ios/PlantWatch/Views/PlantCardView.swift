import SwiftUI

/// One plant per card. Status drives the left stripe color and the badge tint.
struct PlantCardView: View {
    let reading: Reading
    var onInfoTap: (() -> Void)? = nil

    // For offline sensors lead with the honest cause; otherwise the normal advice.
    private var cardAdvice: String {
        if reading.status == .noReading {
            return reading.offlineCause ?? "Not reporting — check the sensor (battery contact or signal range)."
        }
        return reading.advice
    }

    var body: some View {
        HStack(spacing: 0) {
            // Status stripe
            Rectangle()
                .fill(reading.status.tint)
                .opacity(reading.status.stripeOpacity)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 10) {
                header
                if let m = reading.moisture {
                    moisture(value: m)
                    if let lo = reading.idealLow, let hi = reading.idealHigh {
                        MoistureGauge(value: m, low: lo, high: hi, status: reading.status)
                    }
                } else {
                    Text("No reading")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.secondary)
                    if let seen = reading.lastSeenRelative {
                        HStack(spacing: 4) {
                            Image(systemName: "clock").font(.system(size: 10, weight: .semibold))
                            Text("Last seen \(seen)").font(.system(size: 12.5, weight: .semibold))
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                Text(cardAdvice)
                    .font(.system(size: 13.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(
            RoundedRectangle(cornerRadius: DS.cardRadius, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.cardRadius, style: .continuous)
                .stroke(.separator.opacity(0.5), lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: DS.cardRadius, style: .continuous))
    }

    // MARK: – Pieces

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            // Plant emoji in a tinted square
            Text(DS.emoji(for: reading.name, type: reading.type))
                .font(.system(size: 22))
                .frame(width: 40, height: 40)
                .background(Color(.tertiarySystemGroupedBackground),
                            in: RoundedRectangle(cornerRadius: 11, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(reading.name)
                        .font(.system(size: 15.5, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .minimumScaleFactor(0.85)
                        .layoutPriority(1)
                    if !reading.verified {
                        Text("UNVERIFIED")
                            .font(.system(size: 9, weight: .semibold))
                            .tracking(0.5)
                            .foregroundStyle(DS.warn)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(DS.warn.opacity(0.18), in: RoundedRectangle(cornerRadius: 3))
                    }
                }
                HStack(spacing: 6) {
                    Text("CH\(reading.channel)")
                    if let b = reading.battery {
                        Text("·")
                        HStack(spacing: 3) {
                            Image(systemName: "battery.50")
                                .font(.system(size: 10))
                            Text("\(b, specifier: "%.1f")V").monospacedDigit()
                        }
                    }
                    if reading.physicalZoneVerified == false {
                        Text("· zone unverified").foregroundStyle(DS.warn)
                    }
                    if let role = reading.pairRole {
                        Text("· \(role)")
                    }
                    if reading.customRange {
                        Text("· custom range").foregroundStyle(DS.brand)
                    }
                }
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            HStack(spacing: 6) {
                statusBadge
                if onInfoTap != nil {
                    Button(action: { onInfoTap?() }) {
                        Image(systemName: "info.circle")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Plant details")
                }
            }
        }
    }

    private var statusBadge: some View {
        Text(reading.headline.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(reading.status.tint)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(reading.status.tint.opacity(0.16), in: Capsule())
            .fixedSize()
    }

    private func moisture(value: Double) -> some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("\(Int(value.rounded()))")
                    .font(.system(size: 32, weight: .bold))
                    .monospacedDigit()
                Text("%")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let lo = reading.idealLow, let hi = reading.idealHigh {
                Text("Ideal \(lo)–\(hi)%")
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            } else {
                Text("No range set")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// Polished moisture gauge: ideal band shaded, current value as a pill, marker line.
struct MoistureGauge: View {
    let value: Double
    let low: Int
    let high: Int
    let status: Status

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h: CGFloat = 8
            let lowX  = w * CGFloat(min(max(low, 0), 100))  / 100
            let highX = w * CGFloat(min(max(high, 0), 100)) / 100
            let valX  = w * CGFloat(min(max(value, 0), 100)) / 100

            ZStack(alignment: .leading) {
                // Track
                Capsule()
                    .fill(Color(.tertiarySystemGroupedBackground))
                    .frame(height: h)

                // Ideal band
                Capsule()
                    .fill(DS.brandAccent.opacity(0.25))
                    .frame(width: max(highX - lowX, 0), height: h)
                    .offset(x: lowX)

                // Filled portion
                Capsule()
                    .fill(
                        LinearGradient(colors: gradientStops,
                                       startPoint: .leading, endPoint: .trailing)
                    )
                    .frame(width: valX, height: h)

                // Marker
                Capsule()
                    .fill(Color(.label))
                    .frame(width: 3, height: 14)
                    .offset(x: valX - 1.5, y: -3)
                    .shadow(color: Color(.systemBackground), radius: 0, x: 0, y: 0)
                    .overlay(
                        Capsule()
                            .stroke(Color(.systemBackground), lineWidth: 2)
                            .frame(width: 3, height: 14)
                            .offset(x: valX - 1.5, y: -3)
                    )
            }
        }
        .frame(height: 14)
        .animation(.easeOut(duration: 0.6), value: value)
    }

    private var gradientStops: [Color] {
        switch status {
        case .dry, .veryDry:    return [Color(red: 0.82, green: 0.29, blue: 0.24), DS.bad]
        case .tooWet:           return [Color(red: 0.29, green: 0.56, blue: 0.89), DS.info]
        default:                return [DS.brandLight, DS.brand]
        }
    }
}
