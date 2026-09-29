# Q&A prep and rehearsal checklist

## Likely judge questions

**Is the data real?**
The timetable is: 435 classes in 60 rooms, with registered counts and room capacities from the Academic Office "Classroom Details" sheet (Jul–Nov 2026), plus the official academic calendar (6 segments, holidays, the 19–23 Oct break, exams 14–18 Nov). Crowd history, mess sizes and energy numbers are simulated or assumed, and the app labels them so.

**How do you know 691 students leave LHC at 12:55?**
Sum of registered students in every LHC class ending at 12:55 that Monday (only courses in segment 4), × 80% attendance. The attendance rate is an assumption; one week of real crowd reports calibrates it.

**Your food-waste number looks big / small.**
We compare against a conservative baseline: the mess already cooks for typical weekday vs weekend turnout plus 5%. So normal days change about 0%. The gains are calendar cases: about 40% less on a long weekend, and +12–15% in exam week, which avoids shortages. We need one mess manager's real numbers (registered students, plates cooked, rough leftovers) to turn it into a measured result.

**What if someone lies or spams?**
Trust-weighted reports: each reporter's trust is how often they agree with others (a small Dawid–Skene-style truth discovery). Weight is trust², so a new account counts about 1.6%. Only each person's latest report counts, and the history forecast ignores today's reports. Demo: spam "Packed" → level stays Quiet. With IITH login, making many accounts needs many @iith.ac.in addresses.

**What about many coordinated fake accounts?**
They start at 12.5% trust and only gain it by agreeing with honest reports, which makes them useless for lying. Login restricted to @iith.ac.in caps it at one account per student.

**Why not Wi-Fi counts or sensors?**
They're on the roadmap: access-point counts are data access, not hardware, and need the Computer Centre's permission. The app works today without them and would take them as one more input to the same model.

**Is Google login working?**
It's built and tested with mocked Google responses (domain check via the token's `hd` claim, signed sessions). For the demo we run in anonymous mode with an admin PIN, which is safer on stage. It's switched on by setting `GOOGLE_CLIENT_ID`. (Say this only if it hasn't been tested with a real client ID before the demo.)

**Security?**
helmet headers and CSP, CORS locked to our domain, 30 writes/min per IP, 5 wrong admin PINs per 15 min, no user IDs in live events, `npm audit` clean, 19 tests including the security checks. Honest caveat: with sign-in off (the demo), the server trusts the browser's random ID; sign-in fixes that.

**Privacy?**
No location tracking. Reports are shown without names, only a trust percentage. The timetable is institute data that's already published.

**How does the energy estimate work?**
If the timetable says a room is empty and nobody reported it in use, a "yes, the AC is on" is auto-verified. Waste = (AC kW + lights) × hours until the next class (max 3 h) × ₹9/kWh. AC ratings are estimated from seat count; the estate office has the real ratings.

**What happens next semester?**
Download the new classroom sheet as CSV and run `node server/scripts/import-timetable.mjs <csv>`, then update the calendar block from the calendar PDF. About 5 minutes.

**Scale?**
Single Node server with a JSON file today (fine for a pilot). For the whole campus: swap `db.js` for Postgres; the rest of the app only calls get/save.

## Before the demo

- [ ] Deploy to Render (`render.yaml`), open the URL 5 minutes early (the free plan sleeps).
- [ ] Read the generated `ADMIN_PIN` in the Render dashboard.
- [ ] Keep Google sign-in OFF unless it has been tested with a real client ID.
- [ ] Load the app on 3 phones + the laptop, each in its own browser profile.
- [ ] Rehearse the 3-minute script (README → Demo walkthrough) 3 times, timed, using the demo clock.
- [ ] Fill in [name] and [demo URL] on the first and last slides.
- [ ] Ask one mess manager for: registered students, plates cooked per meal, rough leftovers.
