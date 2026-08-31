export const legalOperator = {
  name: 'Kedar Nikhil',
  address: '25-254A, Sanjeeva Nagar, Nandyal',
  privacyEmail: 'kedbnik@gmail.com',
  supportEmail: 'kedbnik@gmail.com',
  phone: '9030279703',
  grievanceOfficer: 'Kedar Nikhil',
} as const;

export type LegalDocumentKind = 'privacy' | 'terms';

export const legalDocuments: Record<LegalDocumentKind, { title: string; content: string }> = {
  privacy: {
    title: 'Privacy Policy',
    // Paste the approved Privacy Policy here without changing its language.
    content: `# SAWAARI PRIVACY POLICY

      ** Effective Date:** 31 August 2026  
** Last Updated:** 31 August 2026

## 1. Introduction

Sawaari("Sawaari", "we", "us" or "our") provides a technology platform that enables customers to request transportation services and enables registered drivers/ captains("Captains") to receive and fulfil eligible ride requests.

Sawaari is operated by:

** [LEGAL ENTITY / OPERATOR NAME] ** Kedar Nikhil
** Registered / Business Address:** 25 - 254A, Sanjeeva Nagar, Nandyal, Andhra Pradesh 518501
  ** Privacy / Grievance Email:** kedbnik@gmail.com  
** Contact Number:** 9030279703

This Privacy Policy explains what personal data we collect through the Sawaari Customer application, Sawaari Captain application and related services, why we collect it, how it is used and shared, how long it may be retained, and the choices available to users.

By using Sawaari, you acknowledge the practices described in this Privacy Policy.

---

# 2. Information We Collect

The information collected depends on whether you use Sawaari as a Customer or Captain and which permissions and services you choose to use.

## 2.1 Account and Identity Information

For Customers, we may collect information such as:

- name;
- mobile phone number;
- email address, where applicable;
- saved addresses such as Home or Work, when voluntarily provided;
- profile information; and
  - account identifiers.

For Captains, we may additionally collect information reasonably necessary to verify eligibility to provide transportation services, including:

- full name;
- mobile phone number;
- address;
- profile photograph;
- driving licence information;
- vehicle details;
- vehicle registration information;
- applicable permits and certificates;
- insurance information;
- bank account information;
- UPI information;
- payment or payout details;
- emergency contact details; and
  - verification or compliance records required under applicable law.

Sawaari may require additional documentation when necessary to comply with transport, safety, tax, payment or other legal requirements.

---

# 3. Location Information

Location information is fundamental to Sawaari's ride services.

## Customers

With the required device permissions, Sawaari may collect a Customer's location to:

  - identify the pickup point;
- show nearby locations;
- assist with destination selection;
- estimate fares and distance;
- match the Customer with Captains;
- track an active ride;
- provide safety functionality;
- investigate ride disputes or safety incidents; and
  - detect misuse or fraudulent activity.

## Captains

Sawaari may collect a Captain's location while the Captain is online or otherwise using location-dependent Captain functionality.

During an active ride, location data may be collected periodically to:

- determine the Captain's position;
  - facilitate navigation and ride tracking;
- show ride progress to the Customer;
- maintain an operational record of the trip;
- calculate or verify distance and ride status;
- investigate complaints or payment disputes;
- identify potentially fraudulent or manipulated rides; and
  - improve rider and Captain safety.

Where background - location access is enabled and permitted by the operating system, certain location functionality may continue while the Captain application is in the background when necessary for an active ride or other clearly disclosed ride - service functionality.

Sawaari does not intend to collect background location when it is unrelated to providing a location - dependent Sawaari service.

---

# 4. Ride and Transaction Information

When a ride is requested or completed, we may collect and maintain information including:

- pickup and destination;
- requested, accepted, cancelled and completed ride times;
- Captain and Customer associated with the ride;
- route and relevant location records;
- estimated and final distance;
- estimated and final fare;
- ride status history;
- payment method;
- payment status;
- free - ride, discount or promotional information;
- tips or Captain bonuses, where applicable;
- cancellation information;
- pickup verification information;
- ratings and feedback; and
  - complaints, support requests and dispute records.

This information is used to operate the ride service, maintain transaction records, resolve disputes, prevent fraud and comply with applicable legal requirements.

---

# 5. Contacts Permission

Sawaari may offer features that allow a Customer to select or add contacts.

Access to the device's contact list is optional and requires the user's permission.

If contact permission is denied, users may continue to add supported contact information manually where that functionality is available.

Sawaari will not intentionally access a user's device contacts unless the relevant device permission has been granted.

Users can revoke contact permission through their device settings.

---

# 6. Communications

Sawaari may process communications associated with the service, including:

- in -app messages between Customers and Captains;
- support communications;
- issue reports;
- feedback;
- notifications;
- ride - status notifications; and
  - safety - related communications.

Where Sawaari provides a button that opens the device's native telephone application, the resulting telephone call may be handled by the user's telecommunications provider rather than through Sawaari.

Standard carrier charges may apply.

---

# 7. Device and Technical Information

We may automatically receive limited technical information necessary for security, troubleshooting and application functionality, such as:

- device type;
- operating system;
- application version;
- device or installation identifiers;
- notification tokens;
- network and connectivity information;
- timestamps;
- authentication and security events;
- error information; and
  - diagnostic logs.

Where application analytics are enabled, Sawaari may also process events relating to how users move through the application, such as whether ride booking is started, completed or abandoned at a particular stage.

Such analytics may be used to understand application performance, improve usability and identify technical problems.

---

# 8. How We Use Personal Data

We may use personal data for purposes including:

  1. creating and administering user accounts;
2. authenticating Customers and Captains;
3. processing ride requests;
4. matching Customers and Captains;
5. calculating estimated fares and distances;
6. managing the ride lifecycle;
7. enabling Customer - Captain communication;
8. providing ride - status notifications;
9. verifying ride completion;
10. processing or recording payments;
11. administering Captain payouts where applicable;
12. maintaining ride history;
13. administering promotions and free rides;
14. responding to complaints and support requests;
15. investigating safety incidents;
16. preventing fraud, account abuse and manipulated rides;
17. improving application reliability and performance;
18. protecting Sawaari, Customers and Captains;
19. complying with legal and regulatory obligations; and
20. enforcing Sawaari's Terms and Conditions.

We aim to collect and process only the data reasonably required for legitimate and disclosed purposes.

---

# 9. Sharing of Information

We do not sell users' personal data.

Personal data may be shared only where reasonably necessary.

## 9.1 Between Customer and Captain

Information necessary to perform a ride may be shared between the matched Customer and Captain.

For example, a Customer may receive information concerning the assigned Captain and vehicle, while a Captain may receive information necessary to identify the Customer, pickup location and destination.

We do not intentionally provide one party with unnecessary financial, identity or account information belonging to the other.

## 9.2 Service Providers

Sawaari may use third - party service providers for services such as:

  - cloud infrastructure;
- databases;
- authentication;
- application hosting;
- maps and location functionality;
- notifications;
- communication services;
- analytics;
- cybersecurity;
- payment processing; and
  - customer support.

These service providers may process information only as required to provide their services to Sawaari and subject to applicable contractual and legal requirements.

Sawaari currently uses cloud / backend infrastructure including Supabase for certain application and database functionality.

Additional providers may be introduced as Sawaari's services develop, and this Privacy Policy will be updated where appropriate.

## 9.3 Legal and Safety Requirements

Information may be disclosed where reasonably necessary to:

- comply with applicable law;
- respond to lawful requests from competent authorities;
- investigate accidents or criminal activity;
- protect a person from harm;
- investigate fraud;
- enforce legal rights;
- respond to court or regulatory orders; or
  - meet transportation or licensing requirements.

---

# 10. Payments and Financial Information

Depending on the payment method selected, rides may be paid through cash, UPI or another supported payment mechanism.

Where payment processing is performed by an external payment service provider, that provider may independently process information necessary to complete the transaction under its own terms and privacy practices.

Sawaari does not intend to store card credentials or UPI PINs.

Captains may provide bank account or UPI details where necessary for payouts or payment administration.

Sensitive payment credentials such as passwords, OTPs, UPI PINs and card PINs should never be sent through Sawaari's chat or support functions.

---

# 11. Data Security

Sawaari uses reasonable administrative and technical safeguards designed to protect personal data from unauthorised access, alteration, disclosure or destruction.

These may include measures relating to:

- authentication;
- access controls;
- database security;
- encryption where appropriate;
- restricted administrative privileges;
- logging and monitoring;
- secure application development;
- backups;
- vulnerability remediation; and
  - fraud detection.

No electronic system can provide an absolute guarantee of security.

Users are responsible for maintaining the security of their own devices, accounts and authentication credentials.

---

# 12. Data Retention

Sawaari retains personal data only for as long as reasonably necessary for the purposes described in this Privacy Policy or as required by applicable law.

Different categories of information may have different retention periods.

For example, certain ride, financial, safety, complaint, fraud - prevention and regulatory records may need to be retained after an account is closed where required for legal compliance, establishment or defence of claims, accounting, dispute resolution, regulatory reporting or public safety.

Where information is no longer required, Sawaari will take reasonable measures to delete, anonymise or otherwise securely dispose of it in accordance with applicable law and technical limitations.

---

# 13. Account Deletion and User Rights

Subject to applicable law, users may request:

- access to information about their personal data;
- correction of inaccurate personal data;
- completion or updating of relevant account information;
- deletion of their account or eligible personal data;
- withdrawal of consent where processing depends upon consent; and
  - resolution of grievances concerning personal data.

Account deletion does not necessarily require immediate deletion of every historical record.Information that must reasonably be retained for legal, safety, fraud - prevention, taxation, accounting or dispute - resolution purposes may remain stored for the applicable retention period.

Requests may be submitted through functionality provided within Sawaari or by contacting:

** Privacy / Grievance Email:** [EMAIL ADDRESS]

---

# 14. Application Permissions

Depending upon the device and features used, Sawaari may request permissions including:

- precise or approximate location;
- background location where operationally necessary;
- notifications;
- contacts;
- camera or photographs where required for profile or document functionality; and
  - other device permissions that become necessary for clearly disclosed application features.

Permission requests do not themselves give Sawaari unrestricted access to the device.

Users can manage supported permissions through their Android or iOS device settings.

Some Sawaari functionality may not operate correctly if a permission essential to that functionality is denied.

---

# 15. Children and Minors

Sawaari accounts intended to independently request and manage transportation services are intended for persons legally capable of entering into the relevant transaction.

Persons under 18 years of age should use Sawaari only in accordance with applicable law and under the responsibility or supervision of a parent or lawful guardian where required.

Captains must satisfy all minimum - age, driving - licence and other legal eligibility requirements applicable to providing transportation services.

---

# 16. Fraud Prevention and Safety

Sawaari may analyse ride, account, device, payment and location information to identify activity that may indicate:

- fraudulent rides;
- manipulated GPS information;
- account misuse;
- payment fraud;
- abuse of promotional offers;
- unauthorised account access;
- safety incidents; or
  - violations of Sawaari's Terms and Conditions.

Where necessary, Sawaari may restrict, suspend or investigate accounts based on such activity, subject to applicable law.

---

# 17. Legal and Regulatory Compliance

Sawaari may process and retain information where reasonably necessary to comply with applicable Indian law, including transportation, consumer - protection, information - technology, privacy, taxation, payment, law - enforcement and safety requirements.

Sawaari intends to align its personal - data practices with the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025 as their applicable provisions come into force.

---

# 18. Changes to this Privacy Policy

Sawaari may update this Privacy Policy where:

- application functionality changes;
- new services are introduced;
- data practices change;
- service providers change; or
  - legal or regulatory requirements change.

Material changes will be communicated through the application or another reasonable method where required.

The effective date displayed at the beginning of this Policy indicates the current version.

---

# 19. Grievance and Privacy Contact

Questions, grievances or requests concerning this Privacy Policy or Sawaari's handling of personal data may be directed to:

  ** Grievance Officer:** Kedar Nikhil
    ** Operator:** Kedar Nikhil
      ** Email:** kedbnik@gmail.com  
** Telephone:** 9030279703
  ** Address:** 25 - 254A, Sanjeeva Nagar, Nandyal, Andhra Pradesh 518501

Users may also have additional statutory remedies available under applicable Indian law.`,
  },
terms: {
  title: 'Terms & Conditions',
    // Paste the approved Terms & Conditions here without changing its language.
    content: `# SAWAARI TERMS AND CONDITIONS

      ** Effective Date:** 31 August 2026
        ** Last Updated:** 31 August 2026

These Terms and Conditions("Terms") govern access to and use of the Sawaari Customer application, Sawaari Captain application and related services.

Sawaari is operated by:

** [LEGAL ENTITY / OPERATOR NAME] ** Kedar Nikhil
    ** Address:** 25 - 254A, Sanjeeva Nagar, Nandyal, Andhra Pradesh 518501
      ** Email:** kedbnik@gmail.com
** Telephone:** 9030279703

By creating an account or using Sawaari, you agree to these Terms.

  ---

# 1. Sawaari Platform

Sawaari provides a technology platform designed to connect persons seeking transportation("Customers") with eligible drivers or transportation providers registered with Sawaari("Captains").

Transportation services available through Sawaari are subject to applicable laws, licences, permits, regulatory approvals and local operating requirements.

Sawaari may restrict, suspend, modify or delay the availability of transportation services in any location where required for legal, safety, operational or regulatory reasons.

---

# 2. Eligibility

Customers must be legally capable of entering into transactions through Sawaari.

Users must provide accurate account information and must not impersonate another person.

Captains must satisfy all requirements applicable to the transportation services they provide, including where applicable:

  - minimum age requirements;
  - valid driving licence;
  - valid vehicle registration;
  - vehicle fitness requirements;
  - applicable permits;
  - insurance;
  - pollution - control certification;
  - required tax or fee payments;
  - vehicle safety requirements; and
    - any additional verification required by Sawaari or applicable law.

Submission or acceptance of a Captain application does not override any legal requirement applying to the Captain or vehicle.

---

# 3. User Accounts

Users are responsible for maintaining the confidentiality and security of their accounts and devices.

An account may not be sold, transferred, rented or shared in a manner that allows an unauthorised person to use another person's identity or Captain credentials.

Users must promptly inform Sawaari if they believe their account has been compromised.

Sawaari may require additional verification if suspicious or unauthorised account activity is detected.

---

# 4. Ride Requests

A Customer may submit a ride request by selecting or confirming a pickup location and destination and completing the applicable booking process.

Submitting a request does not guarantee that a Captain will be available or accept the ride.

A ride is subject to Captain availability, location, vehicle eligibility, network availability and other operational factors.

Sawaari may decline, expire or cancel a ride request where no eligible Captain accepts it or where continuing the request is not reasonably possible.

---

# 5. Captain Acceptance

Captains retain responsibility for deciding whether to accept an eligible ride request except where otherwise required by applicable law or a specific contractual arrangement.

Once a Captain accepts a ride, both Customer and Captain should act reasonably to facilitate the pickup and completion of the ride.

Captains must not allow an unauthorised person to perform a ride using their Sawaari Captain account.

  ---

# 6. Pickup Verification

Sawaari may use verification mechanisms such as a pickup PIN or other authentication method before allowing a ride to proceed.

Customers must provide pickup verification information only to the Captain assigned to the ride.

Captains must not begin or falsely complete a ride by bypassing or manipulating required verification procedures.

---

# 7. Fares

Sawaari may display an estimated fare before a Customer confirms a ride.

The fare may take into consideration factors including:

  - applicable base fare;
  - distance;
  - estimated journey duration;
  - applicable taxes or charges;
  - promotions;
  - discounts;
  - free - ride eligibility; and
    - other components permitted by applicable law.

Where applicable law or a competent transport authority prescribes fares, fare limits or fare - calculation rules, those requirements will take precedence over inconsistent platform rules.

The final fare may differ from an estimate where permitted by applicable law and where relevant journey circumstances materially differ from those used to generate the estimate.

Sawaari will not intentionally impose fares contrary to legally applicable fare restrictions.

---

# 8. Free Rides, Promotions and Offers

Sawaari may provide promotional offers, discounts, Captain incentives or free rides.

Such benefits:

  - may be limited to eligible users;
  - may have usage restrictions;
  - may expire;
  - may be withdrawn where misuse or fraud is detected;
  - have no cash value unless explicitly stated; and
    - may be changed or discontinued subject to applicable law.

Creating multiple accounts, manipulating ride records or otherwise attempting to obtain promotional benefits dishonestly is prohibited.

---

# 9. Payment

Available payment methods may include cash, UPI or other payment methods made available by Sawaari.

The Customer remains responsible for paying all legitimately due ride charges unless the ride is expressly identified as free.

Where a third - party payment processor is used, payment processing may also be governed by the processor's applicable terms.

Captains must accurately confirm receipt or non - receipt of payments where the Sawaari workflow requires such confirmation.

Users must not falsely mark a payment as completed, received or unpaid.

---

# 10. Captain Earnings and Payouts

Captain earnings, incentives, bonuses, commissions, deductions or payouts will be determined according to the commercial arrangement then applicable to the Captain and subject to applicable law.

Sawaari may conduct reasonable verification before processing a Captain payout.

Sawaari may temporarily withhold or review a payout where there is reasonable evidence of:

  - fraud;
  - duplicate rides;
  - manipulated GPS information;
  - unresolved payment discrepancies;
  - materially inconsistent ride records;
  - account compromise; or
    - a legal or regulatory requirement.

Legitimately earned amounts will not be withheld arbitrarily.

---

# 11. Cancellation

Customers and Captains should cancel only through the functionality provided by Sawaari where reasonably possible.

Cancellation charges, if introduced, will be disclosed before they become applicable and will comply with applicable transport and consumer - protection requirements.

Sawaari may identify legitimate cancellation reasons for circumstances such as:

    - safety concerns;
  - incorrect vehicle or Captain;
  - inability to safely reach the pickup location;
  - material discrepancy in the booking;
  - Customer or Captain non - arrival;
  - emergencies;
  - application or network failures; or
    - other circumstances reasonably recognised by Sawaari or applicable regulation.

Sawaari may review repeated or abusive cancellations.

---

# 12. Customer Conduct

Customers must not:

  - threaten, harass or abuse a Captain;
  - intentionally damage a Captain's vehicle;
    - request unlawful transportation;
  - use Sawaari for criminal activity;
    - knowingly provide false pickup or destination information for fraudulent purposes;
    - manipulate promotional eligibility;
  - evade legitimate payment;
  - interfere with Captain driving;
  - demand unsafe or illegal driving; or
    - engage in conduct that endangers another person.

Customers remain responsible for damage they intentionally cause, subject to applicable law.

---

# 13. Captain Conduct and Safety

Captains must:

  - operate lawfully and safely;
  - comply with applicable traffic laws;
  - hold all required licences and permits;
  - maintain the vehicle in roadworthy condition;
  - not drive while impaired;
  - not use another person's Captain identity;
    - carry only the Customer associated with the legitimate booking and permitted accompanying passengers;
  - accurately operate ride - status controls;
  - not manipulate GPS or journey records;
  - not falsely create or complete rides;
  - not demand undisclosed charges;
  - comply with applicable fare requirements; and
    - treat Customers respectfully and without unlawful discrimination.

Sawaari may suspend or permanently remove a Captain for serious safety, fraud or compliance violations.

---

# 14. GPS and Ride Integrity

Sawaari may use application - generated location information and ride - status records to verify the integrity of rides.

Attempting to manipulate, spoof, falsify or interfere with GPS information, timestamps, fare information, ride status or payment status is prohibited.

Sawaari may investigate rides that exhibit unusual location, time, fare or account activity.

---

# 15. Communications

Sawaari may provide tools allowing Customers and Captains to communicate for legitimate ride - related purposes.

Users must not use these features for:

    - harassment;
  - threats;
  - spam;
  - unlawful solicitation;
  - sharing illegal material; or
    - activity unrelated to legitimate use of Sawaari.

Contact information obtained through a ride must not be misused after completion of the ride.

---

# 16. Ratings, Feedback and Complaints

Customers and Captains may be permitted to submit ratings, feedback and complaints.

Feedback must be genuine and relate to an actual Sawaari experience.

Sawaari may investigate serious complaints and may consider relevant ride, location, communication, account and payment records in doing so.

Sawaari may remove fraudulent, abusive or irrelevant submissions where appropriate.

---

# 17. Raise Issue and Dispute Resolution

Users may raise ride, safety, Captain, Customer or payment - related issues through the functionality provided in the application or through Sawaari support.

Users should provide accurate information reasonably necessary to investigate the issue.

Sawaari may review relevant records before determining what platform action is appropriate.

  Nothing in this section limits rights available under applicable consumer - protection or other law.

---

# 18. Emergency Situations

Sawaari is not a replacement for police, ambulance, fire or other emergency services.

Where there is immediate danger, users should contact the appropriate emergency authority.

Sawaari may provide safety or emergency - related features, but availability of those features does not guarantee that emergency assistance will be available or arrive within a particular period.

---

# 19. Location and Permissions

Some Sawaari services require access to device location and other permissions.

A Customer may need location access for booking, pickup and ride tracking.

A Captain may need location access, including appropriate background access during eligible ride activity, to receive rides and enable active - ride tracking.

Users may disable permissions through their device settings, but doing so may make affected Sawaari functionality unavailable.

---

# 20. Service Availability

Sawaari does not guarantee:

  - continuous availability;
  - availability of Captains;
  - acceptance of every ride;
  - uninterrupted internet connectivity;
  - uninterrupted GPS availability;
  - error - free operation; or
    - availability in every geographic location.

Scheduled maintenance, technical failures, regulatory requirements, extreme weather, emergencies, network failures or circumstances outside Sawaari's reasonable control may affect service availability.

  ---

# 21. Regulatory Availability

Sawaari services may be introduced, restricted or operated only in geographic areas and transportation categories where Sawaari determines that the applicable legal and regulatory requirements have been satisfied.

Availability of application functionality does not by itself represent that transportation services are legally available in every jurisdiction.

Sawaari may suspend ride booking or Captain activity where required by a competent authority or applicable law.

---

# 22. Intellectual Property

The Sawaari name, applications, software, designs, graphics, branding, databases and other platform materials are owned by Sawaari or their respective licensors except where otherwise stated.

Users receive a limited, non - exclusive, non - transferable right to use the application for its intended purpose.

Users must not:

  - reverse engineer the application except where legally permitted;
  - copy or commercially exploit Sawaari software;
  - interfere with platform security;
  - scrape Sawaari systems without permission; or
    - use Sawaari intellectual property without authorisation.

---

# 23. Privacy

Use of Sawaari is also governed by the Sawaari Privacy Policy.

The Privacy Policy explains the types of personal information processed through Sawaari and the purposes for which it is used.

---

# 24. Suspension and Termination

Sawaari may restrict, suspend or terminate an account where reasonably necessary because of:

  - fraud;
  - safety risk;
  - identity misrepresentation;
  - repeated serious complaints;
  - payment abuse;
  - GPS manipulation;
  - misuse of promotions;
  - violation of these Terms;
  - legal or regulatory requirements; or
    - use of Sawaari to facilitate unlawful activity.

Where appropriate and legally required, affected users may be given a reasonable opportunity to raise a grievance concerning the decision.

---

# 25. Third - Party Services

Sawaari may rely on third - party services for functions including maps, cloud infrastructure, authentication, communications, payments and notifications.

Sawaari is not responsible for independent services outside its reasonable control, although Sawaari remains responsible for obligations imposed upon it by applicable law.

---

# 26. Disclaimers

Sawaari will exercise reasonable care in operating the technology platform.

    However, transportation inherently involves risks including road accidents, traffic conditions, actions of third parties and circumstances beyond the reasonable control of a technology platform.

  Nothing in these Terms excludes responsibility that cannot lawfully be excluded under Indian law.

---

# 27. Limitation of Liability

To the maximum extent permitted by applicable law, Sawaari will not be responsible for indirect, incidental or consequential loss arising solely from circumstances beyond Sawaari's reasonable control.

This limitation does not apply where liability cannot legally be limited, including rights or remedies that users may have under applicable consumer - protection law.

  Nothing in these Terms should be interpreted as excluding statutory rights available to a consumer.

---

# 28. Changes to the Platform or Terms

Sawaari may modify its functionality or these Terms because of:

  - product changes;
  - safety considerations;
  - legal or regulatory developments;
  - introduction of new services;
  - pricing changes; or
    - changes to operational requirements.

Material changes will be communicated through the application or another reasonable mechanism where required.

Continued use after legally effective updated Terms may constitute acceptance where permitted by applicable law.

Where fresh affirmative consent is legally required, Sawaari will request it.

---

# 29. Governing Law

These Terms are governed by the laws of India.

Subject to applicable consumer - protection law and any mandatory statutory forum, disputes concerning Sawaari will be subject to the jurisdiction of the competent courts and authorities in Andhra Pradesh.

  Nothing in this provision prevents a consumer from exercising rights before a forum having jurisdiction under applicable law.

---

# 30. Grievance Officer and Contact

  Questions, complaints or grievances may be submitted to:

** Grievance Officer:** Kedar Nikhil
    ** Operator:** Kedar Nikhil
      ** Email:** kedbnik@gmail.com  
** Telephone:** 9030279703
    ** Address:** 25 - 254A, Sanjeeva Nagar, Nandyal, Andhra Pradesh 518501

Sawaari will endeavour to process grievances in accordance with applicable legal and regulatory requirements.

---

# 31. Acceptance

By creating a Sawaari account or otherwise agreeing to these Terms through the application, the user confirms that they have had an opportunity to read and understand:

  1. these Terms and Conditions; and
  2. the Sawaari Privacy Policy.

If a user does not agree to these Terms, the user should not create or continue using a Sawaari account.`,
},
};
