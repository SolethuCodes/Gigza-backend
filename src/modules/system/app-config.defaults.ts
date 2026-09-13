export const DEFAULT_FAQS = [
  {
    question: 'How do I book a service?',
    answer:
      'Browse Discover or Home, pick a provider or service, choose your preferred date and time, and confirm your booking details. You’ll get a confirmation once the provider accepts.',
    hidden: false,
  },
  {
    question: 'How and when do I pay?',
    answer:
      'Payments are securely processed through PayFast. Depending on the service, you can pay upfront or once the job is completed — your payment is always held securely until the job is done.',
  },
  {
    question: 'Can I cancel or reschedule a booking?',
    answer:
      'Yes. Open the booking from My Bookings and choose to cancel or message the provider to reschedule, up until the job has started.',
  },
  {
    question: 'How are providers verified?',
    answer:
      'Every provider on E-RRANDS completes KYC identity verification before they can accept bookings, so you always know who’s coming to help.',
  },
];

export const DEFAULT_TERMS = {
  updatedAt: 'January 2026',
  sections: [
    {
      title: '1. Acceptance of terms',
      body: 'By creating an account or using E-RRANDS, you agree to be bound by these Terms of Service. If you do not agree, please do not use the platform.',
    },
    {
      title: '2. What E-RRANDS is',
      body: 'E-RRANDS is a marketplace that connects customers with independent, verified service providers. Providers are not employees or agents of E-RRANDS — they operate as independent businesses responsible for the services they perform.',
    },
    {
      title: '3. Accounts & verification',
      body: 'You must provide accurate information when registering. Providers must complete KYC identity verification before they can accept bookings. We may suspend accounts that provide false information or fail verification.',
    },
    {
      title: '4. Bookings & payments',
      body: 'Payments are processed securely through PayFast. Funds are held until a booking is confirmed complete, then released to the provider less our commission. Quoted prices may vary based on the final scope of work agreed with the provider.',
    },
    {
      title: '5. Cancellations & refunds',
      body: 'Bookings can be cancelled from My Bookings before a provider starts the job. Refunds for cancelled or disputed bookings are assessed case by case and processed back to your original payment method.',
    },
    {
      title: '6. Provider conduct',
      body: 'Providers agree to perform services professionally and in line with our community standards. Repeated cancellations, policy violations, or customer complaints may result in suspension or removal from the platform.',
    },
    {
      title: '7. Limitation of liability',
      body: 'E-RRANDS facilitates the connection between customers and providers but is not liable for the quality, safety, or legality of services rendered. Disputes about service quality should be raised through Support so we can help mediate.',
    },
    {
      title: '8. Changes to these terms',
      body: 'We may update these Terms from time to time. Continued use of the platform after changes take effect constitutes acceptance of the updated Terms.',
    },
  ],
};

export const DEFAULT_PRIVACY = {
  updatedAt: 'January 2026',
  sections: [
    {
      title: 'Information we collect',
      body: 'We collect information you provide directly, such as your name, contact details, profile photo, and payment details, as well as information generated while using the app, like booking history and location data used to find nearby providers.',
    },
    {
      title: 'How we use your information',
      body: 'We use your information to operate the platform — matching you with providers or customers, processing payments, sending booking notifications, and improving our services. We never sell your personal data.',
    },
    {
      title: 'Sharing your information',
      body: 'To complete a booking, we share necessary details (like your name, address, and contact number) between the customer and provider involved. We may also share information with payment processors like PayFast and as required by law.',
    },
    {
      title: 'Data security',
      body: 'We use industry-standard safeguards, including encrypted connections and secure payment processing, to protect your information from unauthorized access.',
    },
    {
      title: 'Your rights',
      body: 'In accordance with South Africa’s Protection of Personal Information Act (POPIA), you have the right to access, correct, or request deletion of your personal information. You can update most details directly from your profile, or contact us for anything else.',
    },
    {
      title: 'Data retention',
      body: 'We retain your information for as long as your account is active, or as needed to comply with legal, tax, and dispute-resolution obligations.',
    },
    {
      title: 'Contact us',
      body: 'If you have questions about this Privacy Policy or how your data is handled, reach out via Help & Support in your profile.',
    },
  ],
};

export const DEFAULT_ONBOARDING = [
  {
    key: 'discover',
    kicker: 'Discover',
    title: 'Find trusted help, fast',
    body: 'Book verified professionals for cleaning, repairs, and errands — all in one app.',
  },
  {
    key: 'verified',
    kicker: 'Verified',
    title: 'Every provider is vetted',
    body: 'ID checks and admin approval keep professionals accountable before they accept a job.',
  },
  {
    key: 'secure',
    kicker: 'Secure',
    title: 'Pay safely, track live',
    body: 'Digital payments in ZAR with real-time updates from booking to completion.',
  },
];

export const DEFAULT_CONTENT_FLAGS = {
  helpHero: true,
  contactEmail: true,
  contactPhone: true,
  supportHours: true,
  faqList: true,
};

export const APP_CONFIG_CREATE = {
  id: 'singleton',
  faqs: DEFAULT_FAQS,
  legalTerms: DEFAULT_TERMS,
  legalPrivacy: DEFAULT_PRIVACY,
  onboardingSlides: DEFAULT_ONBOARDING,
  contentFlags: DEFAULT_CONTENT_FLAGS,
  publishedAt: new Date(),
};

export const PUBLIC_CONFIG_FIELDS = [
  'version',
  'platformName',
  'taglineUser',
  'taglineProvider',
  'splashTagline',
  'poweredBy',
  'helpHeroTitle',
  'helpHeroBody',
  'colorPrimary',
  'colorAccent',
  'colorTeal',
  'supportEmail',
  'supportPhone',
  'supportHours',
  'liveChatEnabled',
  'maintenanceMode',
  'maintenanceMessage',
  'websiteHeadline',
  'websiteSubheadline',
  'websiteFooter',
  'faqs',
  'legalTerms',
  'legalPrivacy',
  'onboardingSlides',
  'contentFlags',
  'publishedAt',
] as const;

export const WRITABLE_CONFIG_FIELDS = [
  'platformName',
  'taglineUser',
  'taglineProvider',
  'splashTagline',
  'poweredBy',
  'helpHeroTitle',
  'helpHeroBody',
  'colorPrimary',
  'colorAccent',
  'colorTeal',
  'supportEmail',
  'supportPhone',
  'supportHours',
  'liveChatEnabled',
  'maintenanceMode',
  'maintenanceMessage',
  'websiteHeadline',
  'websiteSubheadline',
  'websiteFooter',
  'faqs',
  'legalTerms',
  'legalPrivacy',
  'onboardingSlides',
  'contentFlags',
] as const;

export const SUPER_ADMIN_FIELDS = [
  'colorPrimary',
  'colorAccent',
  'colorTeal',
  'maintenanceMode',
  'maintenanceMessage',
] as const;
