# SOFTWARE LICENSE AND SERVICES AGREEMENT

**APT — Automated Positional Trader**

---

**Effective Date:** [___]

**Agreement Number:** APT-GT-[___]

---

## PARTIES

| | |
|---|---|
| **Licensor** | [Licensor Legal Entity Name] ("**Vendor**"), a [jurisdiction] company, with principal offices at [address] |
| **Licensee** | Gravity Team Limited ("**Licensee**" or "**Gravity Team**"), a [jurisdiction] company, with principal offices at [address] |

Each individually a "**Party**" and collectively the "**Parties**."

---

## RECITALS

**A.** Vendor has invested significant expertise, effort, and capital in the research, development, and refinement of proprietary trading technology, including the Software and the APT Logic embedded therein.

**B.** Licensee operates a cryptocurrency options market-making business and has expressed interest in a commercial arrangement in which fees are initially tied to demonstrated performance, allowing Licensee to evaluate the Software's efficacy and build confidence in its outputs before committing to a fixed licensing fee.

**C.** The Advisory Period and performance-based fee structure reflect Vendor's confidence in the Software's capabilities and Vendor's willingness to bear upfront development, integration, and support costs in advance of receiving recurring compensation, on the understanding that the fee mechanism will fairly compensate Vendor for value delivered.

**D.** The Parties wish to set out the terms on which Vendor will license the Software to Licensee, including the conditions for fee commencement, the methodology for calculating performance-based fees, and the respective rights and obligations of the Parties.

**NOW, THEREFORE**, in consideration of the mutual covenants and agreements set forth herein, and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Parties agree as follows:

---

## TABLE OF CONTENTS

- [Recitals](#recitals)

1. [Definitions](#1-definitions)
2. [Grant of License](#2-grant-of-license)
3. [Delivery & Deployment](#3-delivery--deployment)
4. [Advisory Period & Fee Commencement](#4-advisory-period--fee-commencement)
5. [Fees & Payment](#5-fees--payment)
6. [Price Adjustment & Cancellation](#6-price-adjustment--cancellation)
7. [Intellectual Property](#7-intellectual-property)
8. [Data Collection & Egress Rights](#8-data-collection--egress-rights)
9. [Marketing Rights & Publicity](#9-marketing-rights--publicity)
10. [Confidentiality](#10-confidentiality)
11. [Representations & Warranties](#11-representations--warranties)
12. [Limitation of Liability](#12-limitation-of-liability)
13. [Indemnification](#13-indemnification)
14. [Term & Termination](#14-term--termination)
15. [Dispute Resolution](#15-dispute-resolution)
16. [General Provisions](#16-general-provisions)
17. [Signatures](#17-signatures)

**Schedules:**
- [Schedule A — Performance Metric](#schedule-a--performance-metric)
- [Schedule B — Data Egress Specification](#schedule-b--data-egress-specification)
- [Schedule C — Marketing Materials Approval Process](#schedule-c--marketing-materials-approval-process)
- [Schedule D — Ramp-Up Fee Calculation](#schedule-d--ramp-up-fee-calculation)

---

## 1. DEFINITIONS

**1.1** "**APT**" or "**Software**" means the proprietary advisory position terminal software developed and owned by Vendor, including all updates, patches, and new versions delivered to Licensee during the Term, delivered in a format determined by Vendor (which may include, without limitation, a compiled container image, a hosted service, or any other delivery mechanism agreed upon by the Parties).

**1.2** "**Advisory Period**" means the initial period commencing on the Deployment Date during which Vendor provides the Software for evaluation and integration purposes at no recurring licensing fee, subject to the limitations in Section 4.

**1.3** "**APT Logic**" means all algorithms, mathematical models, pricing models, variance calculations, fair value computations, desired position simulations, and any other proprietary computational logic embedded within the Software.

**1.4** "**Advisory Mode**" means the operating mode of the Software in which it generates advisory position outputs and recommendations for review by Licensee personnel, without autonomously modifying any trading parameters or executing any trading actions.

**1.5** "**Autonomous Mode**" means the operating mode of the Software in which it may autonomously adjust trading parameters and execute trading actions within the bounds configured by Licensee, without requiring prior manual approval for each action. Autonomous Mode is only available after the Fee Commencement Date.

**1.6** "**Consumer Price Index**" or "**CPI**" means the Consumer Price Index for All Urban Consumers (CPI-U), U.S. City Average, All Items, as published by the U.S. Bureau of Labor Statistics, or a comparable successor index.

**1.7** "**Corporate IP**" means all data, artifacts, and intellectual property generated through Licensee's use of the Software that are exclusively owned by Licensee, including but not limited to: On-Demand Explanations (to the extent they reflect Licensee's trading strategies and decisions), Daily Trading Wraps, and any trading strategies created by Licensee personnel.

**1.8** "**Operating Mode**" means either Advisory Mode or Autonomous Mode, as selected by Licensee within the Software's configuration interface.

**1.9** "**Data Egress**" means the outbound transmission of data from the Licensee's VPC to Vendor systems, limited exclusively to: (a) Encrypted Logic Logs; (b) Masked Linguistic Telemetry; and (c) Performance Metadata, each as further defined in Section 8.

**1.10** "**Deployment Date**" means the first date on which the Software has begun performance evaluation, marked by the commencement of Book B and Book C transfers under the Agreed Backtest Methodology (Schedule A).

**1.11** "**Fee Commencement Date**" means the date on which recurring Licensing Fees become payable, determined in accordance with Section 4.

**1.12** "**Hard Risk Fuses**" means the firm-owned safety mechanisms and risk limits that operate independently of APT Logic and remain under Licensee's exclusive control at all times.

**1.13** "**Licensing Fee**" means the monthly fee payable by Licensee to Vendor as set out in Section 5, as may be adjusted in accordance with Section 6.

**1.14** "**Parameter Change Integration**" means the milestone at which Licensee integrates APT's recommended trading parameter adjustments into its live trading operations, including without limitation the commencement of internal transfers between Book B and any Market-Facing Book (including but not limited to Book A).

**1.14A** "**Market-Facing Book**" means any trading book on which a live trading algorithm is dependent, or which otherwise carries or transmits exposure to external markets. For the avoidance of doubt, Book C is not a Market-Facing Book.

**1.15** "**Performance Metric**" means the quantitative benchmark defined in Schedule A, calculated using the same formula and methodology as the Performance Basis (Section 5.2(a)) but applied to performance results derived from an agreed backtest methodology rather than live production data, used to determine whether the Software has demonstrated sufficient value to trigger Fee Commencement under Section 4.2(b).

**1.16** "**Shared Data**" means data generated through Licensee's use of the Software that both Parties may access and use, including but not limited to: Adaptive Parameters (trading parameter configurations created, modified, or refined by Licensee personnel or by the Software in Autonomous Mode) and Team Chat and Notes content (communications, annotations, and notes created by Licensee personnel within the Software). Shared Data is owned by Licensee but subject to the access and viewing rights granted to Vendor in Section 7.3.

**1.17** "**Term**" means the duration of this Agreement as set out in Section 14.1.

**1.18** "**Full Licensing Fee**" means the fixed monthly amount of **USD $[38570]** ([38570] United States dollars) that represents the target Licensing Fee, as set out in Section 5.1.

**1.19** "**Ramp-Up Period**" means the period commencing on the Deployment Date during which the Performance-Based Fee is calculated monthly based on the Software's actual or simulated performance, as set out in Section 5.2. No Licensing Fees are payable during the portion of the Ramp-Up Period that falls within the Advisory Period. The Ramp-Up Period ends upon Fee Lock-In.

**1.20** "**Fee Lock-In**" means the event, described in Section 5.3, upon which the Performance-Based Fee first equals or exceeds the Full Licensing Fee in a given month (whether during the Advisory Period or thereafter), after which the Licensing Fee permanently locks in at the Full Licensing Fee for the remainder of the Term. Fee Lock-In may occur based on simulated or backtest performance during the Advisory Period even though no fees are payable during that period.

**1.21** "**VPC**" means the Licensee's Virtual Private Cloud or equivalent infrastructure environment within which the Software is deployed and operated, or such other deployment environment as may be agreed by the Parties.

**1.22** "**Book A**" means Licensee's primary trading book used for its existing market-making operations, which operates independently of the Software.

**1.23** "**Book B**" means the separate trading book established by Licensee exclusively for the purpose of executing positions recommended or directed by the Software. In the context of the Performance Basis (Section 5.2(a) and Schedule D), Book B transacts with Book A using live market data. In the context of the Performance Metric backtest (Section 4.3 and Schedule A), Book B transacts with Book C using the same transfer rules but on a non-market-facing, internal-only basis.

**1.24** "**Book C**" means the internal-only counterparty book used exclusively for the Performance Metric backtest described in Schedule A. Book C serves the same role as Book A in the backtest context — it is the source and destination of all internal transfers with Book B — but is non-market-facing and carries no live trading exposure.

**1.25** "**Allocated Capital**" means the notional capital allocated to Book B for the purposes of the Performance Metric backtest, as mutually agreed upon by the Parties and documented in Schedule A. The Allocated Capital need not be a fixed amount — it may be adjusted from time to time by mutual written agreement of the Parties, and Schedule A shall be updated accordingly.

---

## 2. GRANT OF LICENSE

**2.1 License Grant.** Subject to the terms and conditions of this Agreement, Vendor hereby grants to Licensee a non-exclusive, non-transferable, non-sublicensable, revocable license to use the Software solely for Licensee's internal business operations in connection with cryptocurrency options market-making activities.

**2.2 Scope.** The license permits Licensee to:
- (a) Deploy and operate one (1) instance of the Software within Licensee's deployment environment;
- (b) Allow Licensee's authorized personnel to access and interact with the Software's user interface;
- (c) Configure trading parameters and Hard Risk Fuses within the Software;
- (d) Receive and act upon the Software's advisory position outputs;
- (e) Select and switch between Operating Modes in accordance with Section 2.5.

**2.3 Operating Modes.** The Software supports two Operating Modes:
- (a) **Advisory Mode:** Available to Licensee from the Deployment Date at no recurring Licensing Fee during the Advisory Period. In Advisory Mode, the Software generates position recommendations and parameter suggestions for manual review and implementation by Licensee personnel. The Software shall not autonomously modify any trading parameters or execute any trading actions while in Advisory Mode.
- (b) **Autonomous Mode:** Available to Licensee **only after the Fee Commencement Date**. In Autonomous Mode, the Software may autonomously adjust trading parameters and execute trading actions within the bounds, limits, and risk constraints configured by Licensee. Licensee may configure the scope and boundaries of Autonomous Mode actions at any time through the Software's interface.

**2.4 Autonomous Mode Lock.** Prior to the Fee Commencement Date, the Autonomous Mode functionality shall be technically disabled within the Software. Vendor may, at Licensee's request and at Vendor's sole discretion, enable Autonomous Mode during the Advisory Period. Licensee acknowledges that any use of Autonomous Mode constitutes Parameter Change Integration and shall immediately trigger Fee Commencement under Section 4.2(c).

**2.5 Restrictions.** Licensee shall not:
- (a) Copy, modify, adapt, translate, reverse engineer, decompile, disassemble, or create derivative works of the Software or any portion thereof;
- (b) Sublicense, lease, rent, loan, distribute, or otherwise transfer the Software or any rights therein to any third party;
- (c) Attempt to access, extract, or reconstruct the APT Logic;
- (d) Remove, alter, or obscure any proprietary notices, labels, or marks on the Software;
- (e) Use the Software for the benefit of any third party or operate it as a service bureau;
- (f) Circumvent, disable, or interfere with the Data Egress mechanisms, Entity Masking processes, or any other security features of the Software;
- (g) Deploy the Software outside of Licensee's VPC without prior written consent from Vendor;
- (h) Use the Software's outputs (including position recommendations, parameter suggestions, and advisory signals) to inform, direct, or benefit any trading book other than Book B (or Book C in the backtest context). If Licensee wishes to act on the Software's outputs in any book other than Book B, Licensee must ensure that Book B first reflects the full set of the Software's position recommendations in accordance with Schedule D, Section D.2A. Any use of the Software's outputs on a non-measured book without corresponding execution on Book B shall, if not remedied within five (5) business days of written notice from Vendor, constitute a material breach of this Agreement.

**2.6 Reservation of Rights.** All rights not expressly granted herein are reserved by Vendor. No implied licenses are granted by this Agreement.

---

## 3. DELIVERY & DEPLOYMENT

**3.1 Delivery Format.** The Software shall be delivered in a format determined by Vendor and reasonably agreed upon by Licensee (which may include, without limitation, a compiled container image, a managed cloud service, an on-premise installation package, or any other mechanism). Vendor shall provide Licensee with deployment documentation, configuration guides, and reasonable technical assistance during initial setup.

**3.2 Deployment Environment.** The Parties shall mutually agree on an appropriate deployment environment for the Software, which may include Licensee's VPC, a Vendor-managed cloud environment, a hybrid arrangement, or any other configuration that satisfies both Parties' operational and security requirements. The specific deployment architecture shall be documented in a deployment plan agreed upon prior to the Deployment Date.

**3.2A Advisory Period Infrastructure.** Notwithstanding Section 3.2, during the Advisory Period Vendor may operate the Software (in whole or in part) on Vendor's own infrastructure rather than within Licensee's deployment environment, in order to maximize development speed and iteration. Vendor shall ensure that all data handling during such period complies with the confidentiality and security obligations of this Agreement. Upon the conclusion of the Advisory Period, the Software shall be transitioned to the deployment environment agreed under Section 3.2 unless the Parties agree otherwise in writing.

**3.3 Security.** Vendor shall implement commercially reasonable security measures appropriate to the nature of the Software and the data it processes. Such measures may include, without limitation, encryption, access controls, entity masking, and network isolation. Vendor shall make available to Licensee reasonable documentation describing the security architecture upon request, and shall cooperate in good faith with Licensee's security review processes.

**3.4 Hard Risk Fuses.** Licensee shall retain exclusive ownership and control over all Hard Risk Fuses. The Software shall not override, bypass, or interfere with any Hard Risk Fuse configured by Licensee.

**3.5 Updates & Maintenance.** Vendor shall provide Software updates, bug fixes, and security patches during the Term at no additional charge. Vendor shall use commercially reasonable efforts to respond to Licensee-reported issues within two (2) business days and to resolve critical issues (those materially affecting the Software's core functionality) as promptly as practicable. Licensee shall have the right to test updates in a staging environment before deploying to production.

---

## 4. ADVISORY PERIOD & FEE COMMENCEMENT

**4.1 Advisory Period.** The Advisory Period shall commence on the Deployment Date. During the Advisory Period, Vendor shall provide the Software and associated support services at no recurring Licensing Fee. The Advisory Period is intended to allow Licensee to evaluate the Software's performance, integrate data streams, and build trust in the system's outputs.

**4.2 Fee Commencement Triggers.** The Fee Commencement Date shall be the **earliest** of:

- (a) **Hard Cap:** The date that is [6] months after the Deployment Date, irrespective of whether Parameter Change Integration has occurred or the Performance Metric has been achieved;
- (b) **Performance Trigger:** The date on which the Performance Metric (as defined in Schedule A) is first achieved, as confirmed through the audit process described in Section 4.4;
- (c) **Integration Trigger:** The date on which Parameter Change Integration first occurs;
- (d) **Mutual Extension:** If, at the time the Hard Cap under Section 4.2(a) would otherwise expire, the Agreed Backtest Methodology under Schedule A has not yet produced a full 14-day rolling window of results due to delays in data integration or deployment that are not attributable to Licensee's lack of good faith effort, the Parties may, by mutual written agreement executed prior to the original Hard Cap expiry date, extend the Hard Cap by a further two (2) months. Such extension may be exercised only once. If the Parties do not agree to an extension, the original Hard Cap date shall apply.

**4.2A Licensee Notification of Parameter Change Integration.** Licensee shall notify Vendor in writing within two (2) business days of any event that constitutes or may constitute Parameter Change Integration, including without limitation the commencement of internal transfers between Book B and any Market-Facing Book. The notice shall specify the date on which the integration event first occurred and the nature of the activity. If Licensee fails to provide timely notification, Vendor may provide its own written notice to Licensee identifying the integration event and the date on which it occurred, by reference to the real-time monitoring data available to Vendor under Section 4.5A. The Fee Commencement Date shall then be deemed to be the date identified in Vendor's notice, unless Licensee disputes the date or the characterization of the event within five (5) business days of receiving Vendor's notice, in which case the dispute shall be resolved in accordance with the procedure set out in Section 4.5 (applied mutatis mutandis). Pending resolution of any such dispute, Licensee shall continue to comply with all other obligations under this Agreement. Late notification shall not relieve Licensee of any fee obligation that is ultimately determined to be due.

**4.3 Performance Metric.** The Performance Metric shall be calculated using the backtest methodology documented in Schedule A (the "**Agreed Backtest Methodology**"). The backtest uses the same two-book structure and transfer rules as the Performance Basis (Schedule D), except that Book B transacts with Book C (an internal-only, non-market-facing counterparty book) rather than Book A, and the capital in Book B is notional (the Allocated Capital). The Performance Metric is achieved when the annualized return on Allocated Capital over a rolling 14-day window reaches the threshold specified in Schedule A. The Performance Metric shall be:
- (a) Objectively measurable using data available to both Parties;
- (b) Calculated using the Agreed Backtest Methodology, documented in sufficient detail to permit independent verification;
- (c) Assessed over a continuous rolling period of [14] trading days.

**4.4 Audit Rights on Performance Metric.** Vendor shall have the right, at its own expense, to audit the calculation of the Performance Metric at any time and with reasonable frequency. Such audit rights include:
- (a) Access to the raw data inputs used to calculate the Performance Metric;
- (b) Access to the calculation methodology and any intermediate results;
- (c) The right to appoint an independent third-party auditor, subject to customary confidentiality obligations;
- (d) Licensee shall cooperate in good faith with any such audit and provide requested data within [5] business days of a written request;
- (e) If an audit reveals a material discrepancy (greater than [5]%) in the Performance Metric calculation, Licensee shall promptly correct the calculation and, if the corrected calculation shows the Performance Metric was achieved at an earlier date, the Fee Commencement Date shall be retroactively adjusted accordingly, and any fees owed shall become immediately payable.

**4.5 Dispute on Performance Metric.** If the Parties disagree on whether the Performance Metric has been achieved, the matter shall be referred to an independent third-party auditor mutually agreed upon by both Parties, whose determination shall be final and binding. The cost of such determination shall be borne by the Party whose position is not upheld.

**4.5A Vendor Real-Time Monitoring Access.** Licensee shall provide Vendor with continuous, real-time read-only access to the following data for Book B and Book C (and, after Fee Commencement, Book B and Book A to the extent relevant to transfers with Book B):
- (a) All current positions (including instrument, quantity, and direction);
- (b) Current mark-to-market NAV (calculated on the same basis as Section D.4 of Schedule D);
- (c) A complete log of all internal transfers (including timestamp, instrument, quantity, direction, and transfer price);
- (d) Current cash balances.

Such access shall be provided via a real-time data feed, dashboard, or API, in a format mutually agreed upon by the Parties. Vendor's monitoring access is in addition to (and does not limit) Vendor's audit rights under Sections 4.4 and 5.2(f). Licensee shall ensure that the monitoring system is operational and accessible to Vendor at all times during the Term, subject to reasonable scheduled maintenance.

**4.6 Performance-Based Fee Calculation During Advisory Period.** Beginning on the Deployment Date, Vendor shall calculate the Performance-Based Fee on a monthly basis using the methodology set out in Section 5.2 and Schedule D, applied to the Software's actual or simulated (backtest) performance:
- (a) The calculation shall use the same Performance Basis, percentage, and methodology that would apply after Fee Commencement;
- (b) The performance may be based on the Software's simulated or backtest outputs even if such outputs were not used to execute actual trades or generate actual profits;
- (c) No Licensing Fees shall be payable for any month falling within the Advisory Period, regardless of the calculated Performance-Based Fee amount;
- (d) Vendor shall provide Licensee with a written report of each monthly Performance-Based Fee calculation within [5] business days after the end of each calendar month during the Advisory Period;
- (e) The Advisory Period calculations shall be subject to the same audit rights set out in Section 4.4, mutatis mutandis;
- (f) If Fee Lock-In occurs during the Advisory Period (per Section 5.3), the consequences set out in Section 5.3 shall apply.

---

## 5. FEES & PAYMENT

**5.1 Full Licensing Fee.** The Full Licensing Fee shall be **USD $[38570]** ([38570] United States dollars) per month, unless adjusted in accordance with Section 6.

**5.2 Ramp-Up Period.** The Performance-Based Fee shall be calculated monthly beginning on the Deployment Date, using the Software's actual or simulated (backtest) performance:
- (a) The monthly Performance-Based Fee shall equal **[20]%** of the net profit and loss of Book B (the "**Performance Basis**") for the applicable measurement period, calculated in accordance with the methodology set out in Schedule D;
- (b) The Performance-Based Fee shall not exceed the Full Licensing Fee in any given month;
- (c) **During the Advisory Period:** The Performance-Based Fee shall be calculated and reported but no Licensing Fees shall be payable. The calculation serves to track progress toward Fee Lock-In;
- (d) **After the Fee Commencement Date (if Fee Lock-In has not yet occurred):** The monthly Licensing Fee shall equal the Performance-Based Fee (floored at zero per Section 5.2(g));
- (e) Licensee shall provide Vendor with a written calculation of the Performance-Based Fee within [5] business days after the end of each calendar month;
- (f) Vendor shall have the right to audit the Performance-Based Fee calculation using the same audit rights and procedures set out in Section 4.4, mutatis mutandis;
- (g) **Month-to-Month Independence / No Clawback.** Each month's Performance-Based Fee shall be calculated independently based solely on that month's Performance Basis. If the Performance Basis for a given month is negative, the Performance-Based Fee for that month shall be zero — but no negative performance shall be carried forward, offset against, or used to reduce the Performance-Based Fee payable in any subsequent month. For the avoidance of doubt, if Vendor earns a Performance-Based Fee in one month, Licensee incurs losses in the following month (even losses exceeding prior cumulative gains), and Vendor subsequently earns a positive Performance Basis in a later month, the full Performance-Based Fee shall be payable for that later month. There shall be no clawback, retrospective withholding, high-water mark, or loss carry-forward mechanism of any kind.

**5.3 Fee Lock-In.** Upon the first month in which the Performance-Based Fee equals or exceeds the Full Licensing Fee (whether during the Advisory Period or thereafter):
- (a) The Ramp-Up Period shall immediately and permanently end;
- (b) The monthly Licensing Fee shall be permanently set to the Full Licensing Fee for the remainder of the Term, irrespective of the Software's subsequent performance;
- (c) Vendor shall notify Licensee in writing that Fee Lock-In has occurred, specifying the month in which it was triggered;
- (d) Once Fee Lock-In occurs, it is irreversible — the Licensing Fee shall not revert to a performance-based calculation under any circumstances, including periods of reduced or negative performance;
- (e) **If Fee Lock-In occurs during the Advisory Period:** No Licensing Fees shall be payable for the month in which Fee Lock-In is triggered or any prior month. However, from the Fee Commencement Date onward, the Licensing Fee shall be the Full Licensing Fee (the Ramp-Up Period having already ended). For the avoidance of doubt, Fee Lock-In during the Advisory Period does not accelerate Fee Commencement — fees remain payable only from the Fee Commencement Date as determined under Section 4.2.

**5.4 Payment Terms.** Licensing Fees shall be invoiced monthly and are due within thirty (30) days of the invoice date ("**Net-30**"). No invoices shall be issued for any month falling within the Advisory Period. After the Fee Commencement Date, if Fee Lock-In has not yet occurred, invoices shall be issued in arrears based on the Performance-Based Fee calculation. After Fee Lock-In (whether triggered during the Advisory Period or thereafter), invoices shall be issued in advance at the Full Licensing Fee. All payments shall be made in United States dollars by wire transfer to the account designated by Vendor.

**5.5 Late Payments.** Any amounts not paid when due shall accrue interest at the lesser of (a) 1.5% per month, or (b) the maximum rate permitted by applicable law, calculated from the due date until the date of actual payment.

**5.6 Taxes.** The Licensing Fee is exclusive of all taxes, levies, duties, and governmental assessments. Licensee shall be responsible for all taxes arising from this Agreement, excluding taxes based on Vendor's net income.

**5.7 No Profit Share.** For the avoidance of doubt, the Licensing Fee (whether during the Ramp-Up Period or after Fee Lock-In) is not a profit-sharing arrangement. Vendor shall have no entitlement to any share of profits, revenues, trading gains, or any other financial performance of Licensee beyond the Licensing Fee as calculated under this Section 5.

**5.8 No Refunds.** Licensing Fees paid are non-refundable, except as expressly provided in Section 14.

**5.9 Good Faith and Fair Dealing.** Each Party shall act in good faith and deal fairly in all matters relating to the fee mechanism set out in this Section 5 and Schedules A and D, including without limitation the calculation of the Performance Basis, the determination of Book B NAV, the recording and pricing of internal transfers, and the reporting of Performance-Based Fee calculations. Neither Party shall take any action, or fail to take any action, with the purpose or effect of artificially inflating, deflating, or otherwise manipulating the Performance Basis or any component thereof.

---

## 6. PRICE ADJUSTMENT & CANCELLATION

**6.1 Vendor's Discretionary Price Adjustment.** Vendor may increase the Full Licensing Fee and/or the Performance-Based Fee percentage during the Term, subject to the following limitations:
- (a) Vendor may exercise this right no more than **twice** in any twelve (12) month period;
- (b) No single discretionary increase shall exceed **10%** of the then-current amount of the applicable fee or percentage being adjusted;
- (c) Vendor shall provide Licensee with no fewer than thirty (30) days' prior written notice of any price increase, specifying the new fee amounts and the effective date of the increase.

**6.2 CPI Adjustment.** In addition to Vendor's discretionary right under Section 6.1, the Full Licensing Fee shall be automatically adjusted on each anniversary of the Fee Commencement Date to reflect changes in the Consumer Price Index. The adjustment shall be calculated as follows:
- (a) The adjusted Full Licensing Fee = prior Full Licensing Fee × (CPI for the most recently published twelve-month period / CPI for the twelve-month period immediately preceding the prior adjustment date);
- (b) The CPI adjustment shall only operate to **increase** the Full Licensing Fee; if the CPI decreases, the Full Licensing Fee shall remain unchanged;
- (c) Vendor shall notify Licensee of the CPI-adjusted Full Licensing Fee at least fifteen (15) days prior to the adjustment effective date;
- (d) CPI adjustments are independent of, and in addition to, any discretionary price adjustments under Section 6.1;
- (e) If Fee Lock-In has not yet occurred at the time of a CPI adjustment, the new Full Licensing Fee shall also serve as the updated ceiling for the Performance-Based Fee under Section 5.2(b).

**6.3 Licensee's Right to Cancel.** Licensee may cancel its Licensing Fee obligation, for any reason or no reason, subject to the following:
- (a) **Mid-Term Cancellation:** Licensee may cancel at any time during the Initial Term or any Renewal Period by providing Vendor with thirty (30) days' prior written notice ("**Cancellation Notice**"). If Licensee cancels before the end of the then-current term (whether Initial Term or Renewal Period), Licensee shall pay an early termination fee equal to **50%** of the remaining Full Licensing Fee payments that would have been due through the end of the then-current term (the "**Early Termination Fee**"). The Early Termination Fee shall be due and payable within thirty (30) days of the cancellation effective date. The Parties acknowledge and agree that the Early Termination Fee represents a genuine pre-estimate of Vendor's loss arising from early termination, taking into account Vendor's upfront development costs that are not separately reflected in the fee schedule and the development and support costs incurred by Vendor during the fee-free Advisory Period, and is not intended as a penalty.
- (b) **End-of-Term Non-Renewal:** Licensee may elect not to renew by providing at least sixty (60) days' written notice prior to the end of the then-current term. No Early Termination Fee shall apply for non-renewal.
- (c) Upon the effective date of any cancellation:
  - (i) No further Licensing Fees shall accrue;
  - (ii) All Licensing Fees and any Early Termination Fee accrued prior to the effective date shall remain due and payable;
  - (iii) The license granted under Section 2.1 shall terminate;
  - (iv) Licensee shall comply with the wind-down obligations in Section 14.4.

**6.4 Price Increase and Cancellation Interaction.** If Vendor issues a discretionary price increase notice under Section 6.1, Licensee may terminate this Agreement by providing written notice to Vendor at any time during the thirty (30) day notice period specified in Section 6.1(c), with the termination to take effect on the date the price increase would otherwise become effective. If Licensee terminates under this Section 6.4, **no Early Termination Fee shall be payable** — Licensee shall only be liable for the existing (pre-increase) Licensing Fee through the termination effective date. If Licensee does not exercise this termination right during the notice period, the price increase shall take effect as stated in Vendor's notice and Licensee's subsequent cancellation rights shall be governed by Section 6.3 (including the Early Termination Fee). CPI adjustments under Section 6.2 shall not independently trigger the termination right under this Section 6.4.

**6.5 Reinstatement.** If Licensee cancels and subsequently wishes to reinstate the license, reinstatement shall be subject to Vendor's approval (which Vendor shall consider in good faith), at the then-current Licensing Fee, and subject to a new Initial Term of twelve (12) months.

---

## 7. INTELLECTUAL PROPERTY

**7.1 Vendor IP.** Licensee acknowledges and agrees that:
- (a) The APT Logic, including all algorithms, models, and computational methods embedded in the Software, is and shall remain the sole and exclusive property of Vendor;
- (b) The Software (including its source code, object code, architecture, and design) is and shall remain the sole and exclusive property of Vendor;
- (c) Nothing in this Agreement grants Licensee any ownership interest in the APT Logic or the Software;
- (d) Vendor retains the APT Logic across all client engagements and may use general learnings, techniques, and know-how developed during the performance of this Agreement in its other business activities, provided such use does not disclose Licensee's Confidential Information.

**7.2 Licensee IP (Corporate IP).** Vendor acknowledges and agrees that all Corporate IP is and shall remain the sole and exclusive property of Licensee. This includes, without limitation:
- (a) **On-Demand Explanations** — all explanation outputs generated by the Software in response to Licensee queries, to the extent they reflect Licensee's trading strategies and decisions;
- (b) **Daily Trading Wraps** — all automated summary reports generated from Licensee's trading activity;
- (c) Any trading strategies, proprietary methodologies, or confidential business logic created by Licensee personnel.

**7.3 Shared Data.** The following categories of data ("**Shared Data**") are owned by Licensee but subject to the viewing and access rights granted to Vendor herein:
- (a) **Adaptive Parameters** — all trading parameter configurations created, modified, or refined by Licensee personnel or by the Software in Autonomous Mode. Vendor shall have the right to view, access, and analyse Adaptive Parameters for the purposes of Software improvement, debugging, support, and performance monitoring;
- (b) **Team Chat and Notes** — all communications, annotations, and notes created by Licensee personnel within the Software. Vendor shall have the right to view, access, and analyse Team Chat and Notes content for the purposes of Software improvement, debugging, support, and quality assurance.

Vendor's access to Shared Data shall not be construed as a transfer of ownership. Vendor shall not disclose Shared Data in identifiable form to any third party except as required by law or as permitted under Section 8.

**7.4 Data Portability.** Upon termination or expiration of this Agreement, Vendor shall provide Licensee with a complete export of all Corporate IP and Shared Data in a machine-readable format within thirty (30) days of the termination effective date, at no additional charge.

**7.5 No Contamination.** Vendor shall implement reasonable technical and organizational measures to ensure that Licensee's Corporate IP is not commingled with data from any other Vendor client or used to train, improve, or benefit the Software as deployed for any other client, except in anonymized and aggregated form that cannot be attributed to Licensee. This restriction does not apply to Shared Data, which Vendor may use in anonymized form across its product improvement efforts.

**7.6 Custom Indicators and Tools.** Any custom indicators, analytical tools, models, or other deliverables developed by Vendor for Licensee during the Term (whether at Licensee's request or on Vendor's initiative) shall be and remain the sole intellectual property of Vendor. Licensee is granted a non-exclusive, non-transferable, royalty-free license to use such custom indicators and tools for its internal business operations for the duration of the Term. Vendor retains the right to use, modify, sublicense, and provide such custom indicators and tools to any other client or third party, provided that Vendor does not disclose Licensee's Confidential Information in connection with such use.

**7.7 Improvements and Derivative Works.** All improvements, enhancements, modifications, updates, and derivative works of the Software or the APT Logic — regardless of whether they were prompted by, inspired by, or developed in response to Licensee's usage patterns, feedback, feature requests, bug reports, or any other input from Licensee — are and shall remain the sole and exclusive intellectual property of Vendor. To the extent that Licensee's feedback or input gives rise to any intellectual property rights in improvements or derivative works, Licensee hereby assigns such rights to Vendor, to the extent permitted by applicable law. For the avoidance of doubt, no suggestion, feedback, or feature request from Licensee shall create a joint work, joint ownership, or any intellectual property claim by Licensee in the Software or the APT Logic. Where Vendor develops a material new feature or capability that was substantially prompted by Licensee's specific written feature request, Vendor shall use commercially reasonable efforts to make such feature available to Licensee under this license at no additional charge during the Term.

---

## 8. DATA COLLECTION & EGRESS RIGHTS

**8.1 Grant of Data Collection Rights.** Licensee hereby grants Vendor the right to collect, receive, store, process, and use the following categories of data transmitted from the Software deployed within Licensee's VPC to Vendor's systems (collectively, "**Egress Data**"):

- (a) **Encrypted Logic Logs** — encrypted records of the Software's internal computational processes, used by Vendor for debugging, performance optimization, and model improvement. These logs shall not contain any identifiable trading positions, strategies, or financial data of Licensee in unencrypted form;

- (b) **Masked Linguistic Telemetry** — anonymized and entity-masked records of natural language interactions with the Software (e.g., team chat, investigation queries), used by Vendor for improving the Software's linguistic and explanatory capabilities. All identifying information (names, entities, specific instrument identifiers) shall be masked prior to egress;

- (c) **Performance Metadata** — aggregated, non-identifying performance statistics relating to the Software's operational metrics (e.g., response times, uptime, system resource utilization, model accuracy metrics), used by Vendor for product improvement and quality assurance.

**8.2 Entity Masking.** All Egress Data shall pass through the Software's Entity Masking layer prior to transmission. The Entity Masking process shall:
- (a) Remove or replace all identifiers that could attribute the data to Licensee, its personnel, or its trading counterparties;
- (b) Be fully auditable by Licensee's engineering team;
- (c) Not be modified, weakened, or bypassed by Vendor without Licensee's prior written consent.

**8.3 Permitted Uses.** Vendor may use the Egress Data for any lawful purpose, including but not limited to:
- (a) Debugging, maintaining, and improving the Software;
- (b) Developing new features, products, or capabilities;
- (c) Generating aggregated, anonymized benchmarks, statistics, reports, and datasets;
- (d) Commercializing, licensing, selling, or otherwise distributing derived datasets, analytics products, benchmarks, or insights based on the Egress Data, provided that any such commercialization uses only entity-masked or aggregated data that cannot reasonably be attributed to Licensee;
- (e) Research, academic publications, and industry analysis;
- (f) Fulfilling Vendor's obligations under this Agreement.

**8.4 Restrictions on Egress Data Use.** Notwithstanding the broad rights granted in Section 8.3, Vendor shall not:
- (a) Disclose Egress Data in raw, unmasked, or identifiable form to any third party;
- (b) Use the Egress Data to reverse-engineer Licensee's trading strategies, specific positions, or proprietary methods;
- (c) Re-identify or attempt to re-identify masked data to attribute it to Licensee, its personnel, or its counterparties.

**8.5 Data Retention.** Vendor shall have the right to retain Egress Data **indefinitely**, both during and after the Term of this Agreement. Vendor's right to retain and use Egress Data in accordance with Sections 8.3 and 8.4 shall survive termination or expiration of this Agreement without limitation. For the avoidance of doubt, Vendor's indefinite retention right applies only to Egress Data (which has already been entity-masked) and does not extend to Corporate IP or identifiable Shared Data.

**8.6 Ownership of Entity-Masked Egress Data.** Licensee acknowledges and agrees that once Egress Data has passed through the Entity Masking process described in Section 8.2, the resulting entity-masked data shall be the sole and exclusive property of Vendor. Vendor shall hold an irrevocable, perpetual, worldwide, royalty-free right to use, store, reproduce, modify, create derivative works from, distribute, commercialize, and otherwise exploit such entity-masked Egress Data for any purpose permitted under this Agreement. This ownership right survives termination or expiration of this Agreement. For the avoidance of doubt, Vendor's use of entity-masked Egress Data remains subject to the restrictions in Section 8.4 (including the prohibition on re-identification).

---

## 9. MARKETING RIGHTS & PUBLICITY

**9.1 Grant of Marketing Rights.** Licensee hereby grants Vendor a non-exclusive, royalty-free, worldwide license to use the following for Vendor's marketing, promotional, sales, and business development purposes:

- (a) **Name:** Licensee's company name "Gravity Team" and any common abbreviations or trade names;
- (b) **Logo:** Licensee's company logo(s) as provided by Licensee to Vendor in digital format;
- (c) **Performance Statistics:** High-level, aggregated performance statistics derived from Licensee's use of the Software, subject to the limitations in Section 9.3.

**9.2 Permitted Uses.** Vendor may use the rights granted under Section 9.1 in the following contexts:
- (a) Vendor's website, pitch decks, and investor presentations;
- (b) Case studies, white papers, and blog posts;
- (c) Social media posts and digital advertising;
- (d) Conference presentations and speaking engagements;
- (e) Communications with prospective clients and partners.

**9.3 Limitations on Performance Statistics.** Vendor's use of Licensee's performance statistics is subject to the following:
- (a) Statistics must be presented at a **high level only** (e.g., "improved Sharpe ratio by X%", "achieved Y% return on capital") and shall not disclose specific trading strategies, position sizes, PnL figures, or any other granular financial data;
- (b) Vendor shall submit any proposed marketing material referencing Licensee's performance statistics to Licensee for **prior written approval**, which shall not be unreasonably withheld or delayed. Licensee shall respond within fifteen (15) business days; failure to respond shall be deemed approval;
- (c) All statistics used must be accurate and not misleading;
- (d) Vendor shall include appropriate disclaimers (e.g., "past performance does not guarantee future results") in any materials referencing performance statistics.

**9.4 Logo Usage Guidelines.** Vendor shall use Licensee's logo(s) in accordance with any brand guidelines provided by Licensee. Vendor shall not modify, distort, or alter the logo(s) except for proportional resizing.

**9.5 Duration.** The marketing rights granted under this Section 9 shall survive termination or expiration of this Agreement indefinitely, unless Licensee provides written notice revoking such rights, in which case Vendor shall cease all use within thirty (30) days of receiving such notice.

**9.6 Reciprocal Right.** Vendor grants Licensee a non-exclusive, royalty-free license to identify Vendor and the Software by name in Licensee's internal and external communications, including for recruitment, investor relations, and industry communications.

---

## 10. CONFIDENTIALITY

**10.1 Definition.** "**Confidential Information**" means any non-public information disclosed by one Party ("**Disclosing Party**") to the other Party ("**Receiving Party**"), whether orally, in writing, or in any other form, that is designated as confidential or that a reasonable person would understand to be confidential given the nature of the information and circumstances of disclosure. Confidential Information includes, without limitation:
- (a) For Vendor: APT Logic, source code, algorithms, business plans, pricing, and client lists;
- (b) For Licensee: trading strategies, position data, financial information, personnel information, Corporate IP, and Shared Data (to the extent not already accessible to Vendor under Section 7.3).

**10.2 Obligations.** The Receiving Party shall:
- (a) Hold all Confidential Information in strict confidence;
- (b) Not disclose Confidential Information to any third party without the Disclosing Party's prior written consent;
- (c) Use Confidential Information solely for the purposes of this Agreement;
- (d) Restrict access to Confidential Information to those employees, contractors, and advisors who have a need to know and are bound by confidentiality obligations at least as restrictive as those herein.

**10.3 Exceptions.** Confidential Information does not include information that:
- (a) Is or becomes publicly available through no fault of the Receiving Party;
- (b) Was already known to the Receiving Party without restriction prior to disclosure;
- (c) Is independently developed by the Receiving Party without use of or reference to the Disclosing Party's Confidential Information;
- (d) Is received from a third party without restriction and without breach of any obligation of confidentiality.

**10.4 Compelled Disclosure.** If the Receiving Party is compelled by law, regulation, or legal process to disclose Confidential Information, it shall provide the Disclosing Party with prompt written notice (to the extent legally permitted) and cooperate with the Disclosing Party's efforts to obtain a protective order or other appropriate remedy.

**10.5 Duration.** The confidentiality obligations under this Section 10 shall survive termination or expiration of this Agreement for a period of five (5) years, except with respect to trade secrets, which shall be protected for as long as they remain trade secrets under applicable law.

---

## 11. REPRESENTATIONS & WARRANTIES

**11.1 Vendor Representations.** Vendor represents and warrants that:
- (a) Vendor has the legal right and authority to enter into this Agreement and grant the rights herein;
- (b) The Software does not, to Vendor's knowledge, infringe upon the intellectual property rights of any third party;
- (c) The Software shall be free from malware, viruses, trojans, backdoors, or any other malicious code at the time of delivery;
- (d) The Software shall perform substantially in accordance with its documentation during the Term;
- (e) Vendor shall provide commercially reasonable efforts to maintain Software availability of at least 90% uptime, measured on a monthly basis, excluding scheduled maintenance windows communicated to Licensee with at least 48 hours' prior notice;
- (f) Vendor shall comply with all applicable laws and regulations in the performance of its obligations under this Agreement.

**11.2 Licensee Representations.** Licensee represents and warrants that:
- (a) Licensee has the legal right and authority to enter into this Agreement;
- (b) Licensee shall use the Software in compliance with all applicable laws, regulations, and industry standards;
- (c) Licensee shall maintain appropriate security measures within its VPC to protect the Software and all data processed therein;
- (d) Licensee shall not use the Software for any unlawful purpose.

**11.3 Disclaimer.** EXCEPT AS EXPRESSLY SET FORTH IN THIS SECTION 11, THE SOFTWARE IS PROVIDED "AS IS." VENDOR MAKES NO OTHER WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. VENDOR DOES NOT WARRANT THAT THE SOFTWARE WILL BE ERROR-FREE OR UNINTERRUPTED, OR THAT IT WILL GENERATE PROFITS OR ANY PARTICULAR TRADING OUTCOME FOR LICENSEE.

**11.4 Operating Mode Acknowledgements.** Licensee expressly acknowledges that:
- (a) **Advisory Mode:** When operating in Advisory Mode, the Software provides advisory outputs only. The Software does not execute trades or modify trading parameters autonomously. All trading decisions remain the sole responsibility of Licensee.
- (b) **Autonomous Mode:** When operating in Autonomous Mode, the Software may autonomously adjust trading parameters and execute trading actions within the bounds configured by Licensee. Licensee is solely responsible for configuring appropriate risk limits, boundaries, and constraints for Autonomous Mode operation. Licensee acknowledges that it has elected to enable Autonomous Mode at its own discretion.
- (c) **No Liability for Trading Outcomes:** Regardless of which Operating Mode is in use, Vendor shall have no liability for any trading losses, adverse market outcomes, missed opportunities, or any other financial consequences incurred by Licensee, whether or not such outcomes are attributable to the Software's outputs or autonomous actions. Licensee assumes all risk associated with the use of the Software in any Operating Mode.

---

## 12. LIMITATION OF LIABILITY

**12.1 Cap.** TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, VENDOR'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR IN CONNECTION WITH THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNT OF LICENSING FEES ACTUALLY PAID BY LICENSEE TO VENDOR DURING THE TWELVE (12) MONTH PERIOD IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.

**12.2 Exclusion of Consequential Damages.** IN NO EVENT SHALL EITHER PARTY BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, LOSS OF DATA, LOSS OF BUSINESS OPPORTUNITY, TRADING LOSSES, OR COST OF PROCUREMENT OF SUBSTITUTE SERVICES, REGARDLESS OF THE CAUSE OF ACTION OR THE THEORY OF LIABILITY, EVEN IF SUCH PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

**12.3 Exceptions.** The limitations in Sections 12.1 and 12.2 shall not apply to:
- (a) Either Party's breach of Section 10 (Confidentiality);
- (b) Either Party's indemnification obligations under Section 13;
- (c) Licensee's obligation to pay Licensing Fees;
- (d) Liability arising from a Party's gross negligence or willful misconduct.

---

## 13. INDEMNIFICATION

**13.1 Vendor Indemnification.** Vendor shall indemnify, defend, and hold harmless Licensee and its officers, directors, employees, and agents from and against any third-party claims, demands, losses, damages, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to:
- (a) Any claim that the Software infringes or misappropriates a third party's intellectual property rights;
- (b) Vendor's breach of its confidentiality obligations under Section 10;
- (c) Vendor's gross negligence or willful misconduct.

**13.2 Licensee Indemnification.** Licensee shall indemnify, defend, and hold harmless Vendor and its officers, directors, employees, and agents from and against any third-party claims, demands, losses, damages, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to:
- (a) Licensee's use of the Software in violation of this Agreement or applicable law;
- (b) Licensee's breach of its confidentiality obligations under Section 10;
- (c) Any trading activity conducted by Licensee, whether or not influenced by the Software's outputs.

**13.3 Indemnification Procedure.** The indemnified Party shall:
- (a) Promptly notify the indemnifying Party in writing of any claim;
- (b) Grant the indemnifying Party sole control of the defense and settlement of the claim;
- (c) Cooperate with the indemnifying Party at the indemnifying Party's expense.

---

## 14. TERM & TERMINATION

**14.1 Term.** This Agreement shall commence on the Effective Date. The initial paid term shall be a period of twelve (12) months commencing on the Fee Commencement Date (the "**Initial Term**"). Upon expiration of the Initial Term, this Agreement shall automatically renew for successive twelve (12) month periods (each a "**Renewal Period**"), unless either Party provides the other with at least sixty (60) days' prior written notice of non-renewal before the end of the then-current term.

**14.2 Termination by Licensee.** Licensee may terminate this Agreement by exercising its cancellation right under Section 6.3. During the Initial Term or any Renewal Period, early termination is subject to the Early Termination Fee set out in Section 6.3(a). Licensee may elect not to renew by providing at least sixty (60) days' written notice prior to the end of the then-current term.

**14.3 Termination by Vendor.** Vendor may terminate this Agreement:
- (a) Upon thirty (30) days' written notice if Licensee fails to pay any undisputed Licensing Fee or Early Termination Fee within sixty (60) days of the due date;
- (b) Immediately upon written notice if Licensee materially breaches Sections 2.5 (Restrictions), 7 (Intellectual Property), or 10 (Confidentiality) and fails to cure such breach within fifteen (15) days of receiving written notice;
- (c) Immediately upon written notice if Licensee becomes insolvent, files for bankruptcy, or ceases to operate as a going concern.

**14.4 Wind-Down Obligations.** Upon termination or expiration of this Agreement:
- (a) Licensee shall cease all use of the Software within seven (7) days;
- (b) Licensee shall delete or destroy all copies of the Software (including any container images, installation packages, or other deliverables) within fourteen (14) days and provide written certification of such deletion;
- (c) Vendor shall export and deliver all Corporate IP and Shared Data to Licensee in accordance with Section 7.4;
- (d) All accrued payment obligations shall survive termination;
- (e) Sections 7, 8.5, 8.6, 9.5, 10, 11.3, 11.4, 12, 13, 14.5, 14.6, 15, and 16 shall survive termination;
- (f) If termination occurs before the end of the then-current term (whether Initial Term or Renewal Period), the Early Termination Fee provisions of Section 6.3(a) shall apply.

**14.5 Post-Termination Non-Compete.** The Parties acknowledge that during the Term, Licensee will have had substantial exposure to the APT Logic's outputs, methodologies, and behavioral patterns. To protect Vendor's proprietary investment, for a period of twelve (12) months following the effective date of termination or expiration of this Agreement (the "**Restricted Period**"), Licensee shall not, directly or indirectly, deploy, develop, commission, license, or use any software, system, algorithm, or methodology that replicates, is substantially similar to, or was derived from or inspired by the APT Logic, the Software's architecture, or the Software's outputs. The intent of this restriction is to prevent the direct cloning or reverse-engineering of the APT Logic — it is not intended to restrict Licensee's ordinary business operations or use of generally available commercial software and independently developed tools that were not influenced by the Software or the APT Logic.

**14.6 Non-Solicitation.** During the Term and for a period of twelve (12) months following the effective date of termination or expiration of this Agreement, Licensee shall not, directly or indirectly, solicit, recruit, hire, engage, or contract with any employee, contractor, or consultant of Vendor who was involved in the development, deployment, or support of the Software, without Vendor's prior written consent. This restriction does not apply to general, untargeted recruitment advertisements or to individuals who approach Licensee without solicitation.

---

## 15. DISPUTE RESOLUTION

**15.1 Governing Law.** This Agreement shall be governed by and construed in accordance with the laws of the Commonwealth of Australia, without regard to its conflict of laws principles.

**15.2 Negotiation.** The Parties shall attempt in good faith to resolve any dispute arising out of or relating to this Agreement through direct negotiation between senior executives within thirty (30) days of written notice of the dispute.

**15.3 Mediation.** If the dispute is not resolved through negotiation, the Parties shall submit the dispute to mediation administered by the Australian Disputes Centre (ADC) in accordance with its mediation rules. The mediation shall take place in Sydney, Australia.

**15.4 Arbitration.** If the dispute is not resolved through mediation within sixty (60) days, the dispute shall be finally resolved by binding arbitration administered by the Australian Centre for International Commercial Arbitration (ACICA) in accordance with the ACICA Arbitration Rules in force at the time of filing. The arbitration shall be conducted by a single arbitrator in Sydney, Australia. The language of the arbitration shall be English. The arbitrator's decision shall be final and binding and may be entered as a judgment in any court of competent jurisdiction.

**15.5 Interim Relief.** Notwithstanding the foregoing, either Party may seek injunctive or other equitable relief from a court of competent jurisdiction to prevent irreparable harm pending the outcome of arbitration, particularly in relation to breaches of Sections 2.5, 7, or 10.

**15.6 Costs.** Each Party shall bear its own costs in connection with any dispute resolution proceedings, except that the prevailing Party in any arbitration shall be entitled to recover its reasonable attorneys' fees and costs from the non-prevailing Party.

---

## 16. GENERAL PROVISIONS

**16.1 Force Majeure.** Neither Party shall be liable for any failure or delay in performing its obligations under this Agreement (other than payment obligations) to the extent such failure or delay results from causes beyond its reasonable control, including but not limited to acts of God, natural disasters, war, terrorism, riots, embargoes, acts of governmental authorities, fire, floods, epidemics, pandemics, network infrastructure failures, or power outages.

**16.2 Assignment.** Neither Party may assign or transfer this Agreement or any rights or obligations hereunder without the prior written consent of the other Party, except that either Party may assign this Agreement without consent in connection with a merger, acquisition, or sale of all or substantially all of its assets, provided the assignee agrees to be bound by the terms hereof.

**16.3 Entire Agreement.** This Agreement, together with all Schedules attached hereto, constitutes the entire agreement between the Parties with respect to its subject matter and supersedes all prior and contemporaneous agreements, representations, warranties, and understandings, whether written or oral.

**16.4 Amendments.** This Agreement may only be amended or modified by a written instrument signed by authorized representatives of both Parties.

**16.5 Severability.** If any provision of this Agreement is held to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect, and the invalid provision shall be modified to the minimum extent necessary to make it valid, legal, and enforceable while preserving its original intent.

**16.6 Waiver.** No failure or delay by either Party in exercising any right under this Agreement shall constitute a waiver of that right. A waiver of any right on one occasion shall not be construed as a waiver of that right on any subsequent occasion.

**16.7 Notices.** All notices required or permitted under this Agreement shall be in writing and shall be deemed given when:
- (a) Delivered personally;
- (b) Sent by confirmed email to the addresses set forth below; or
- (c) Three (3) business days after being sent by registered or certified mail, return receipt requested.

| | |
|---|---|
| **To Vendor:** | [Name], [Email], [Address] |
| **To Licensee:** | [Name], [Email], [Address] |

**16.8 Independent Contractors.** The relationship between the Parties is that of independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency, or employment relationship between the Parties.

**16.9 Third-Party Beneficiaries.** This Agreement is for the sole benefit of the Parties and their permitted successors and assigns. Nothing in this Agreement confers any rights on any third party.

**16.10 Counterparts.** This Agreement may be executed in counterparts, each of which shall be deemed an original, and all of which together shall constitute one and the same instrument. Electronic signatures shall be deemed valid and binding.

**16.11 Regulatory Change.** If a change in applicable law, regulation, or regulatory guidance materially prevents or restricts either Party's ability to perform its obligations under this Agreement, the affected Party shall promptly notify the other Party in writing, specifying the nature of the regulatory change and its impact. The Parties shall negotiate in good faith for a period of sixty (60) days to agree upon modifications to the affected terms that preserve the commercial intent of this Agreement to the greatest extent possible. If no agreement is reached within the sixty (60) day negotiation period, either Party may terminate this Agreement upon thirty (30) days' written notice without incurring any Early Termination Fee. All Licensing Fees accrued prior to the termination effective date shall remain due and payable.

---

## 17. SIGNATURES

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.

| | |
|---|---|
| **VENDOR** | **LICENSEE** |
| | |
| Signature: _________________________ | Signature: _________________________ |
| Name: [___] | Name: [___] |
| Title: [___] | Title: [___] |
| Date: [___] | Date: [___] |

---

## SCHEDULE A — PERFORMANCE METRIC

*To be mutually agreed upon and documented prior to the Deployment Date.*

### A.1 Metric Parameters

| Item | Detail |
|---|---|
| **Metric Name** | Annualized Return on Allocated Capital |
| **Measurement Period** | Rolling 14 trading days |
| **Threshold for Achievement** | 10% annualized return on Allocated Capital |
| **Allocated Capital** | As mutually agreed by the Parties (notional; may be adjusted by mutual written agreement per Section 1.25) |
| **Data Sources** | Book B and Book C internal transfer records; midprice data from the applicable venue |
| **Reporting Frequency** | Daily (rolling window updated each trading day) |
| **Responsible Party for Calculation** | Licensee, subject to Vendor audit rights (Section 4.4) |

### A.2 Backtest Book Structure

Licensee shall maintain Book B and Book C as two internal-only, non-market-facing books for the purposes of this backtest. Neither book carries live trading exposure or interacts with any external venue or counterparty.

- **Book B** holds the positions recommended or directed by the Software, funded with the Allocated Capital.
- **Book C** serves as the internal counterparty to Book B — the source and destination of all transfers — analogous to the role of Book A in the live Performance Basis calculation.

### A.3 Transfer Rules

All transfers between Book B and Book C shall follow the same rules as Section D.3 of Schedule D:

- (a) **Option Transfers** shall be priced at the **prevailing midprice** of the relevant option at the time of transfer.
- (b) **Delta-Hedging Transfers** shall accompany each option transfer to render the combined transfer delta-neutral, priced at the **prevailing futures midprice**.
- (c) **Gamma Hedging** transfers of futures between Book B and Book C shall be priced at the **prevailing futures midprice**.
- (d) Book B shall not transact with any party other than Book C.

### A.4 Return Calculation

The return on Allocated Capital for a given rolling 14-day window is calculated as follows:

> **14-Day Return = (Book B NAV at Window End − Book B NAV at Window Start) / Allocated Capital**

Where Book B NAV is calculated on the same basis as Section D.4 of Schedule D (mark-to-market value of open positions plus cash balance).

The annualized return is:

> **Annualized Return = 14-Day Return × (365.25 / 14)**

### A.5 Trigger Condition

The Performance Metric is achieved on the first trading day on which the Annualized Return (calculated per Section A.4) equals or exceeds **10%**. Upon achievement, the Fee Commencement Date is triggered per Section 4.2(b), subject to the audit and dispute provisions of Sections 4.4 and 4.5.

---

## SCHEDULE B — DATA EGRESS SPECIFICATION

| Data Category | Description | Masking Applied | Retention Period |
|---|---|---|---|
| Encrypted Logic Logs | Encrypted records of APT's internal computational processes | Full encryption; no plaintext trading data | Indefinite (per §8.5) |
| Masked Linguistic Telemetry | Anonymized NLP interaction records (chat, queries, explanations) | Entity masking: names, instruments, counterparties replaced | Indefinite (per §8.5) |
| Performance Metadata | Aggregated system performance statistics (latency, uptime, accuracy) | No firm-identifying information included | Indefinite (per §8.5) |

---

## SCHEDULE C — MARKETING MATERIALS APPROVAL PROCESS

| Step | Action | Timeline |
|---|---|---|
| 1 | Vendor submits draft marketing material to Licensee contact | — |
| 2 | Licensee reviews and provides approval, conditional approval, or rejection | 15 business days |
| 3 | If conditional, Vendor revises and resubmits | 5 business days |
| 4 | Licensee provides final approval | 5 business days |
| 5 | Failure to respond within the stated timelines is deemed approval | — |

**Licensee Marketing Contact:** [___]

**Vendor Marketing Contact:** [___]

---

## SCHEDULE D — RAMP-UP FEE CALCULATION

*Defines the Performance-Based Fee calculation used during the Ramp-Up Period (Section 5.2). Calculation begins on the Deployment Date (including during the Advisory Period, per Section 4.6). Once Fee Lock-In occurs (Section 5.3), this Schedule ceases to apply and the Full Licensing Fee is charged permanently.*

### D.1 Fee Parameters

| Item | Detail |
|---|---|
| **Full Licensing Fee** | USD $[38570] per month |
| **Minimum Monthly Fee** | USD $0 per month (no minimum; fee is floored at zero per Section 5.2(g)) |
| **Performance-Based Fee Percentage** | 20% of the Performance Basis |
| **Performance Type During Advisory Period** | Actual or simulated (backtest) performance of the Software's outputs |
| **Measurement Period** | Trailing calendar month |
| **Calculation Start Date** | Deployment Date |
| **Reporting Deadline** | [5] business days after end of each measurement period |
| **Responsible Party for Calculation** | Licensee, subject to Vendor audit rights |
| **Audit Mechanism** | Per Section 4.4 (applied mutatis mutandis per Sections 4.6(e) and 5.2(f)) |

### D.2 Two-Book Structure

Licensee shall establish and maintain Book B as a separate trading book, distinct from Book A (Licensee's primary market-making book). Book B shall be used exclusively to execute the positions recommended or directed by the Software. The net profit and loss of Book B over each measurement period constitutes the **Performance Basis**.

### D.2A Completeness of Book B Positions

Book B must at all times reflect the **complete set** of position recommendations generated by the Software — Licensee may not selectively execute a subset of the Software's recommendations in Book B while disregarding others. If the Software recommends a position in a given instrument, Book B must execute the corresponding transfer with Book A in accordance with Section D.3.

In **Advisory Mode**, Licensee retains the right to override or decline individual position recommendations for its own trading operations outside of Book B. However, for the purposes of calculating the Performance Basis, the positions in Book B shall reflect what the Software recommended, not what Licensee chose to execute elsewhere. If Licensee overrides a recommendation and does not execute the corresponding transfer in Book B, the Performance Basis shall nonetheless be calculated as if Book B had executed the recommendation at the prevailing midprice at the time the recommendation was generated, using a notional shadow record maintained by Vendor via the monitoring access described in Section 4.5A.

In **Autonomous Mode**, the Software shall directly control Book B's position transfers, and the completeness requirement is automatically satisfied.

Failure to maintain Book B in accordance with this Section D.2A, or any manipulation of Book B's positions to artificially reduce the Performance Basis, shall — if not remedied within five (5) business days of written notice from Vendor — constitute a material breach of this Agreement.

### D.3 Transfer and Hedging Rules

All transfers between Book A and Book B, and all hedging activity within Book B, shall be conducted in accordance with the following rules:

- (a) **Option Transfers.** Book B shall acquire or dispose of option positions by way of internal transfer with Book A. Each option transfer shall be priced at the **prevailing midprice** of the relevant option at the time of transfer (i.e., the arithmetic mean of the best bid and best ask on the applicable venue).

- (b) **Delta-Hedging Transfers.** Each option transfer under paragraph (a) shall be accompanied by a corresponding futures transfer to render the combined transfer delta-neutral. The futures component of each such transfer shall also be priced at the **prevailing futures midprice** at the time of transfer.

- (c) **Gamma Hedging.** Book B may independently execute gamma-hedging trades by transferring futures positions with Book A. All such gamma-hedging futures transfers shall be priced at the **prevailing futures midprice** at the time of transfer.

- (d) **No Other Transfers.** Book B shall not transact with any counterparty other than Book A, and shall not execute trades on any external venue. All position changes in Book B shall occur exclusively through internal transfers with Book A in accordance with paragraphs (a) through (c).

### D.4 Performance Basis Calculation

The **Performance Basis** for a given measurement period is the net profit and loss of Book B, calculated as follows:

> **Performance Basis = Book B Ending NAV − Book B Beginning NAV**

Where:
- **Book B Ending NAV** is the total net asset value of Book B at the close of the measurement period, comprising: (i) the mark-to-market value of all open positions, plus (ii) the cash balance, including all realized proceeds from option exercises, expirations, and settlements during the period;
- **Book B Beginning NAV** is the total net asset value of Book B at the start of the measurement period, calculated on the same basis.

For the avoidance of doubt, the cost of all internal transfers with Book A (priced at the midprices specified in Section D.3) is reflected in Book B's cash balance at the time of transfer and therefore already captured within the NAV calculation.

All open positions shall be marked to market using the midprice of each instrument on the applicable venue at the relevant valuation time. For the avoidance of doubt, the PnL from options that expire or are settled during the measurement period is fully captured through the cash balance component of NAV.

### D.5 Monthly Fee Calculation

> **Monthly Performance-Based Fee = max(20% × Performance Basis, 0)**

If the Performance Basis for a given month is negative, the Performance-Based Fee for that month is zero. The Performance-Based Fee shall not exceed the Full Licensing Fee in any given month. Each month's fee is calculated independently — no negative performance is carried forward or offset against future months' fees. There is no clawback, high-water mark, or loss carry-forward mechanism of any kind (see Section 5.2(g)). During the Advisory Period, the Performance-Based Fee is calculated and reported but no fees are payable (per Section 5.2(c)).

### D.6 Fee Lock-In Trigger

The Ramp-Up Period ends permanently when the Performance-Based Fee for any single month equals or exceeds the Full Licensing Fee — including months during the Advisory Period based on simulated or backtest performance. From that point forward, the monthly Licensing Fee is the Full Licensing Fee regardless of subsequent performance. No fees are payable for Advisory Period months even if Fee Lock-In occurs during that period (Section 5.3(e)).

---

*End of Agreement*
