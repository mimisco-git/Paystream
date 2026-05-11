# PayStream — Demo Video Script
# 2 minutes exactly. Read this while recording your screen.
# Rehearse twice before recording.
# =====================================================

## SETUP BEFORE RECORDING
- Open frontend/index.html in Chrome, full screen
- Open frontend/app.html in a second tab
- Have Arc testnet explorer open in a third tab
- Make sure your mic is clear and background is quiet
- Record at 1080p

---

## [0:00 - 0:18] THE HOOK — show the landing page

**Say:**
"9 million expat workers in the UAE are paid once a month.
They work every day but wait 30, sometimes 60 days to receive money they have already earned.
PayStream fixes this.
Watch this counter."

**Do:** Point at the live USDC counter on the landing page, ticking upward in real time.

**Say:**
"Every second, this worker's balance grows.
Not monthly. Not weekly. Every. Single. Second."

---

## [0:18 - 0:38] THE PRODUCT — switch to app.html, worker view

**Say:**
"This is Ahmad. He is a web developer based in Dubai, working for a UAE tech company.
His employer deposited USDC into PayStream this morning.
Since that moment, Ahmad has been earning."

**Do:** Point at the earn counter. Point at the AED dual currency display below it.

**Say:**
"We show both USDC and AED — the UAE dirham — because this product is built for the region.
The stream rate is $18.50 per hour. That is 67 AED per hour.
The AI agent in the background monitors Ahmad's work activity.
If he stops working, the stream pauses automatically. No overpayment."

---

## [0:38 - 1:02] THE WITHDRAWAL — open the withdraw modal

**Say:**
"Now watch what happens when Ahmad needs money urgently.
Maybe it is 2am. Maybe there is an emergency.
Under the old system he would wait until payday."

**Do:** Click "Withdraw USDC". Choose Ethereum as destination. Enter $200. Click Confirm.

**Say:**
"He picks Ethereum, enters $200, and confirms.
Watch the processing log."

**Do:** Let the CCTP processing animation play through all steps.

**Say:**
"Circle's Cross-Chain Transfer Protocol burns USDC on Arc and mints it on Ethereum.
Done. $200 delivered cross-chain in under 20 seconds.
No bank. No wire transfer. No 3-day wait."

---

## [1:02 - 1:22] THE TECHNOLOGY — switch to employer view

**Say:**
"On the employer side, the company deposits a USDC float via Circle Gateway.
That float is distributed automatically to four workers right now —
each with their own Circle developer-controlled wallet on Arc testnet."

**Do:** Scroll through the worker list showing active streams.

**Say:**
"Every payout is recorded on PayStream dot sol — our smart contract on Arc —
and you can verify every single transaction on the Arc testnet explorer."

**Do:** Briefly show the history tab with transaction hashes.

**Say:**
"Full on-chain audit trail. Every cent accounted for."

---

## [1:22 - 1:45] CIRCLE TOOLS — show architecture diagram

**Do:** Switch to architecture.html. Click a few nodes to show tooltips.

**Say:**
"PayStream uses five Circle tools, each chosen for a specific reason.
Circle developer-controlled wallets handle server-side key custody —
this is what makes automated per-minute payments possible without user signing.
Nanopayments enable sub-cent USDC transfers at near-zero cost on Arc.
Circle Gateway gives workers a unified balance across all chains.
CCTP handles cross-chain withdrawals in a single API call.
And Arc's deterministic finality confirms every transaction in under one second."

---

## [1:45 - 2:00] THE CLOSE — back to landing page counter

**Do:** Switch back to index.html. The counter is still ticking.

**Say:**
"While we have been talking, Ahmad has earned another $0.37 USDC —
136 dirham if he withdraws in the UAE.
PayStream is live on Arc testnet today.
The code is open source on GitHub.
This is what real-time payroll looks like."

**Do:** Let the counter tick for 3 more seconds. Fade out.

---

## RECORDING TIPS

- Keep your voice steady and calm. Do not rush.
- Pause one second after each section heading.
- If you make a mistake, pause, breathe, continue — edit in post.
- Record in one take if possible. Judges can tell when it is over-edited.
- Use OBS or Loom. Export at 1080p 30fps.
- Upload to YouTube as unlisted, paste the link in your submission.

## WHAT JUDGES ARE SCORING

1. Problem clarity — covered at 0:00
2. Solution demonstration — covered at 0:18 and 0:38
3. Circle tools integration — covered at 1:22
4. UAE/regional relevance — covered throughout with AED display and Ahmad's story
5. Technical depth — covered with smart contract mention and architecture diagram
6. Polish and presentation — your delivery and the UI quality
