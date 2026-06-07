'use strict';

const { query } = require('./index');

const BUILT_IN_SCENARIOS = [
  {
    title: 'Unencrypted PAN Found on File Share',
    description: 'A routine DLP scan flags a network file share containing thousands of unencrypted PANs in a spreadsheet. The share is accessible to all domain users.',
    roles: ['facilitator', 'ir_lead', 'ir_analyst', 'system_owner', 'legal'],
    requirement_focus: ['12.10.1', '12.10.3', '12.10.5', '12.10.7', '3.4'],
    injects: [
      { order: 1, delay_min: 0,  prompt: 'DLP alert received: 12,000+ PANs detected on \\\\fileserver\\shared\\reports\\2024_sales.xlsx. File has been open for 3 days. Confirm scope and initiate response.' },
      { order: 2, delay_min: 10, prompt: 'IT confirms the file has been accessed by 47 users in the past 72 hours. Access logs are available. How do you contain and preserve evidence?' },
      { order: 3, delay_min: 20, prompt: 'Legal asks: do we have a 72-hour card brand notification obligation? Walk through your determination.' },
      { order: 4, delay_min: 35, prompt: 'A journalist calls the PR team asking about a "data leak." Comms escalates to you. How do you respond while investigation is ongoing?' },
      { order: 5, delay_min: 50, prompt: 'After-action: What process failed that allowed unencrypted PANs to be stored here? What controls address 12.10.7?' },
    ],
  },
  {
    title: 'Skimmer Detected on POS Terminal',
    description: 'A store manager notices a suspicious device attached to a POS terminal at closing time. Physical skimmer confirmed by security team.',
    roles: ['facilitator', 'ir_lead', 'ir_analyst', 'physical_security', 'store_ops'],
    requirement_focus: ['12.10.1', '12.10.3', '12.10.5', '9.9', '12.10.7'],
    injects: [
      { order: 1, delay_min: 0,  prompt: 'Skimmer confirmed on POS terminal #4 at Store 22. Device has been in place for an unknown duration. Camera footage is being pulled. What are your first 5 actions?' },
      { order: 2, delay_min: 10, prompt: 'Footage shows skimmer installed 6 days ago. Estimated 3,200 card transactions processed during that period. Initiate notification decision tree.' },
      { order: 3, delay_min: 20, prompt: 'Acquiring bank is on the phone. They want a preliminary incident report within 2 hours. What do you provide and what do you withhold pending investigation?' },
      { order: 4, delay_min: 35, prompt: 'Law enforcement wants to take the device as evidence immediately. Your forensics team has not yet imaged it. How do you handle this conflict?' },
      { order: 5, delay_min: 50, prompt: 'Requirement 9.9 requires periodic inspection of POS terminals. Demonstrate how your current process would have caught this earlier.' },
    ],
  },
  {
    title: 'Third-Party Service Provider Breach',
    description: 'Your payment processor notifies you that they experienced a breach affecting merchants including your organization. Scope is unknown.',
    roles: ['facilitator', 'ir_lead', 'ir_analyst', 'vendor_manager', 'legal'],
    requirement_focus: ['12.10.1', '12.10.2', '12.8', '12.10.6'],
    injects: [
      { order: 1, delay_min: 0,  prompt: 'Email received from payment processor at 11 PM: "We have experienced a security incident that may have affected transaction data for your account between Jan 1–Mar 15." No further detail. What do you do right now?' },
      { order: 2, delay_min: 15, prompt: 'Processor confirms cardholder data was accessed but cannot yet confirm volume. Your TPSP agreement requires 24hr notification — they are 14 hours past that. Document this.' },
      { order: 3, delay_min: 25, prompt: 'Your own notification clock: does a third-party breach trigger YOUR 72-hour obligation to card brands? Walk through the analysis.' },
      { order: 4, delay_min: 40, prompt: 'The processor asks you NOT to notify card brands independently, saying they will handle it. Do you comply? What are the risks?' },
      { order: 5, delay_min: 55, prompt: 'Post-incident: what changes to your 12.8 TPSP management controls would prevent or accelerate response to this scenario?' },
    ],
  },
  {
    title: 'Ransomware in CDE-Adjacent Network',
    description: 'Ransomware is detected on servers in a network segment adjacent to the Cardholder Data Environment. Lateral movement to CDE is possible but unconfirmed.',
    roles: ['facilitator', 'ir_lead', 'ir_analyst', 'network_eng', 'ciso'],
    requirement_focus: ['12.10.1', '12.10.5', '10.7', '1.3', '12.10.3'],
    injects: [
      { order: 1, delay_min: 0,  prompt: 'EDR alerts on ransomware encryption activity across 12 servers in VLAN 30. CDE is in VLAN 10. Firewall rules allow limited traffic between them. Declare incident severity and initial containment.' },
      { order: 2, delay_min: 10, prompt: 'Network team confirms a firewall rule change 3 days ago opened port 445 between VLAN 30 and VLAN 10 for a "temporary" file share. Has the CDE been breached? How do you determine this?' },
      { order: 3, delay_min: 25, prompt: '10.7 requires detection/reporting of critical control failures. The firewall change bypassed change control. Document this failure and its audit log entry.' },
      { order: 4, delay_min: 40, prompt: 'CISO wants to pay the ransom to recover faster. IR Lead disagrees. Facilitator: walk through the legal, PCI, and operational considerations of each path.' },
      { order: 5, delay_min: 55, prompt: 'If CDE compromise cannot be ruled out, what is your notification posture? Draft the preliminary card brand notification.' },
    ],
  },
  {
    title: 'Insider Threat — Rogue Employee',
    description: 'HR notifies IR that a terminated employee\'s credentials were used to access the payment database 48 hours after offboarding.',
    roles: ['facilitator', 'ir_lead', 'ir_analyst', 'hr', 'legal'],
    requirement_focus: ['12.10.1', '7.2', '8.2', '10.2', '12.10.3'],
    injects: [
      { order: 1, delay_min: 0,  prompt: 'SIEM alert: terminated employee J. Smith\'s Active Directory account authenticated to payment-db-01 at 2:14 AM, 48 hours after termination date. Account should have been disabled. What are your first actions?' },
      { order: 2, delay_min: 10, prompt: 'Logs show the account ran 4 SELECT queries against the card_transactions table returning ~8,000 rows. Data exfiltration cannot be ruled out. Requirement 10.2 — what specific log entries do you need?' },
      { order: 3, delay_min: 20, prompt: 'HR confirms offboarding checklist was completed but IT never received the disable-account ticket due to a process gap. Document the control failure against Requirements 7.2 and 8.2.' },
      { order: 4, delay_min: 35, prompt: 'Legal advises you not to contact the former employee without law enforcement involved. FBI is notified. Does this change your 72-hour notification analysis?' },
      { order: 5, delay_min: 50, prompt: 'After-action: design the access revocation control that would have prevented this. Which PCI-DSS requirements does it satisfy?' },
    ],
  },
];

async function seedScenarios() {
  for (const scenario of BUILT_IN_SCENARIOS) {
    const { rows } = await query(
      'SELECT id FROM tabletop_scenarios WHERE title = $1 AND is_builtin = TRUE',
      [scenario.title]
    );
    if (rows.length > 0) continue;

    await query(
      `INSERT INTO tabletop_scenarios
         (title, description, injects, roles, requirement_focus, is_builtin)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [
        scenario.title,
        scenario.description,
        JSON.stringify(scenario.injects),
        scenario.roles,
        scenario.requirement_focus,
      ]
    );
  }
}

module.exports = { seedScenarios };
