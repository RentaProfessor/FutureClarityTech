import SwiftUI

/// The big at-a-glance summary at the top of the report.
struct HeroCardView: View {
    let report: PlantReport

    private var headline: (eyebrow: String, title: String, sub: String) {
        let c = report.counts
        if c.needsWater == 0 && c.tooWet == 0 && c.missing == 0 {
            return ("ALL SET", "Garden looks happy.",
                    "All \(c.good) plants in their ideal range.")
        }
        if c.needsWater > 0 {
            let dry = report.readings
                .filter(\.needsWater)
                .sorted { (($0.idealLow ?? 0) - Int($0.moisture ?? 0)) > (($1.idealLow ?? 0) - Int($1.moisture ?? 0)) }
            let names = dry.prefix(3).map(\.name).joined(separator: ", ")
            let more = dry.count > 3 ? " +\(dry.count - 3) more" : ""
            return ("ACTION NEEDED",
                    "\(c.needsWater) plant\(c.needsWater == 1 ? "" : "s") need\(c.needsWater == 1 ? "s" : "") water",
                    names + more)
        }
        if c.tooWet > 0 {
            let names = report.readings.filter { $0.status == .tooWet }.map(\.name).joined(separator: ", ")
            return ("HEADS UP",
                    "\(c.tooWet) plant\(c.tooWet == 1 ? "" : "s") too wet",
                    names)
        }
        return ("HEADS UP",
                "\(c.missing) sensor\(c.missing == 1 ? "" : "s") not reporting",
                "Check the affected gateway.")
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Background gradient + decorative blob
            RoundedRectangle(cornerRadius: DS.heroRadius, style: .continuous)
                .fill(LinearGradient(colors: [DS.brand, DS.brandLight],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(
                    Circle()
                        .fill(Color.white.opacity(0.08))
                        .frame(width: 280, height: 280)
                        .offset(x: 140, y: 120)
                        .clipShape(RoundedRectangle(cornerRadius: DS.heroRadius, style: .continuous))
                )

            VStack(alignment: .leading, spacing: 8) {
                Text(headline.eyebrow)
                    .font(.system(size: 11.5, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(.white.opacity(0.85))

                Text(headline.title)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)

                Text(headline.sub)
                    .font(.system(size: 14.5))
                    .foregroundStyle(.white.opacity(0.92))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)

                if report.weather.available {
                    WeatherChip(weather: report.weather)
                        .padding(.top, 12)
                }

                StatRow(counts: report.counts)
                    .padding(.top, 16)
            }
            .padding(20)
        }
        .shadow(color: .black.opacity(0.12), radius: 20, x: 0, y: 8)
    }
}

/// Weather chip — plain today/tomorrow facts. No predictive alerts.
private struct WeatherChip: View {
    let weather: Weather
    var body: some View {
        let parts: [String] = {
            var p: [String] = []
            if let t = weather.tempNowF        { p.append("Now \(t)°F") }
            if let h = weather.humidityNow     { p.append("\(h)% RH") }
            if let hi = weather.highTodayF {
                if let lo = weather.lowTodayF { p.append("Today \(hi)°F / \(lo)°F low") }
                else                           { p.append("Today \(hi)°F") }
            }
            if let r = weather.rainTodayIn, r >= 0.05 {
                p.append(String(format: "%.2f\" rain today", r))
            }
            if let ht = weather.highTomorrowF {
                var bit = "Tomorrow \(ht)°F"
                if let rt = weather.rainTomorrowIn, rt >= 0.05 { bit += String(format: ", %.2f\" rain", rt) }
                p.append(bit)
            }
            return p
        }()
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "cloud.fill")
                .font(.system(size: 11, weight: .semibold))
                .padding(.top, 2)
            Text(parts.joined(separator: " · "))
                .font(.system(size: 13, weight: .medium))
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.white.opacity(0.15), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct StatRow: View {
    let counts: Counts
    var body: some View {
        HStack(spacing: 18) {
            stat(value: counts.needsWater, label: "NEED WATER")
            stat(value: counts.tooWet,     label: "TOO WET")
            stat(value: counts.good,       label: "DOING FINE")
            if counts.missing  > 0 { stat(value: counts.missing,  label: "OFFLINE")     }
        }
    }
    private func stat(value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)")
                .font(.system(size: 22, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white)
            Text(label)
                .font(.system(size: 10.5, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(.white.opacity(0.85))
        }
    }
}
