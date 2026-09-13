# Errands Use-Case Flow

This document describes the main use-case flows for the Errands platform, including authentication, account management, customer service requests, provider bookings, payments, and admin/manager operations.

---

# Part 1: Authentication, Service Requests, Bookings, and Payments

## 1. Main Actors

### Customer/User

The customer is the person who creates an account, logs in, requests a service, gets matched with providers, creates a booking, pays for the booking, and tracks the booking status.

### Provider

The provider is the service professional or company that registers a provider account, manages their profile, adds service categories, views open service requests, accepts or declines bookings, updates their location, and completes jobs.

### System

The system handles authentication, account verification, service request matching, booking lifecycle, notifications, payments, and account/profile management.

---

## 2. Customer/User Authentication Flow

### Use Case: Register Customer Account

**Goal:**  
Allow a new customer to create an account.

**Endpoint:**

```http
POST /api/v1/auth/register
```

**Flow:**

1. Customer opens the app.
2. Customer selects **Register**.
3. Customer enters name, email, phone number, password, and required profile details.
4. App sends the registration request to:

```http
POST /api/v1/auth/register
```

5. System creates a new record in the `users` table.
6. System may require email or phone verification.
7. Customer receives an OTP by email or SMS.
8. Customer verifies the account using:

```http
POST /api/v1/auth/verify-email
```

or

```http
POST /api/v1/auth/verify-phone
```

9. After successful verification, the account becomes active.
10. Customer can now log in.

**Result:**  
A new customer account is created and verified.

---

### Use Case: Customer Login

**Goal:**  
Allow an existing customer to access the system.

**Endpoint:**

```http
POST /api/v1/auth/login
```

**Flow:**

1. Customer opens the app.
2. Customer enters email and password.
3. App sends login request to:

```http
POST /api/v1/auth/login
```

4. System validates credentials.
5. If 2FA is not enabled, the system returns an access token and refresh token.
6. If 2FA is enabled, the system asks the customer to enter a 2FA code.
7. Customer enters the 2FA code.
8. App verifies the code using:

```http
POST /api/v1/auth/2fa/verify
```

9. If valid, the customer is logged in.

**Result:**  
Customer gains access to the app.

---

### Use Case: Customer Social Login

**Goal:**  
Allow the customer to log in using Google or Facebook.

#### Google Flow

1. Customer selects **Continue with Google**.
2. App redirects customer to:

```http
GET /api/v1/auth/google
```

3. Google handles authentication.
4. Google redirects back to:

```http
GET /api/v1/auth/google/callback
```

5. System creates or logs in the customer account.

#### Facebook Flow

1. Customer selects **Continue with Facebook**.
2. App redirects customer to:

```http
GET /api/v1/auth/facebook
```

3. Facebook handles authentication.
4. Facebook redirects back to:

```http
GET /api/v1/auth/facebook/callback
```

5. System creates or logs in the customer account.

**Result:**  
Customer logs in using a social account.

---

## 3. Provider Authentication Flow

### Use Case: Register Provider Account

**Goal:**  
Allow a service provider to create a provider account.

**Endpoint:**

```http
POST /api/v1/auth/provider/register
```

**Flow:**

1. Provider opens the app.
2. Provider selects **Register as Provider**.
3. Provider enters business/profile details, email, phone number, password, and service information.
4. App sends request to:

```http
POST /api/v1/auth/provider/register
```

5. System creates a new provider record in the `providers` table.
6. System may require email or phone verification.
7. Provider verifies email using:

```http
POST /api/v1/auth/verify-email
```

8. Provider verifies phone using:

```http
POST /api/v1/auth/verify-phone
```

9. Provider account becomes active after successful verification.

**Result:**  
Provider account is created and ready for profile setup.

---

### Use Case: Provider Login

**Goal:**  
Allow a provider to access provider features.

**Endpoint:**

```http
POST /api/v1/auth/provider/login
```

**Flow:**

1. Provider opens the app.
2. Provider enters email and password.
3. App sends request to:

```http
POST /api/v1/auth/provider/login
```

4. System validates provider credentials.
5. If 2FA is not enabled, provider receives access and refresh tokens.
6. If 2FA is enabled, provider enters verification code.
7. App verifies code using:

```http
POST /api/v1/auth/2fa/verify
```

8. Provider is logged in.

**Result:**  
Provider can access provider dashboard and booking features.

---

## 4. Two-Factor Authentication Flow

### Use Case: Setup and Enable 2FA

**Goal:**  
Allow customers or providers to secure their accounts using 2FA.

**Related Endpoints:**

```http
POST /api/v1/auth/2fa/setup
POST /api/v1/auth/2fa/enable
POST /api/v1/auth/2fa/verify
```

**Flow:**

1. Logged-in customer or provider opens account security settings.
2. User selects **Enable Two-Factor Authentication**.
3. App requests setup information from:

```http
POST /api/v1/auth/2fa/setup
```

4. System returns a secret and QR code URL.
5. User scans the QR code using an authenticator app.
6. User enters the generated verification code.
7. App sends code to:

```http
POST /api/v1/auth/2fa/enable
```

8. System verifies the code.
9. If correct, 2FA is enabled on the account.

**Result:**  
The account now requires 2FA verification during login.

---

## 5. Password Recovery Flow

### Use Case: Forgot and Reset Password

**Goal:**  
Allow users or providers to reset forgotten passwords.

**Related Endpoints:**

```http
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

**Flow:**

1. User selects **Forgot Password**.
2. User enters email address.
3. App sends request to:

```http
POST /api/v1/auth/forgot-password
```

4. System sends password reset email.
5. User opens reset link from email.
6. User enters new password.
7. App sends request to:

```http
POST /api/v1/auth/reset-password
```

8. System validates reset token.
9. System updates the password.

**Result:**  
User or provider can log in with the new password.

---

## 6. Token Refresh and Logout Flow

### Use Case: Refresh Session

**Goal:**  
Keep the user logged in without requiring repeated login.

**Endpoint:**

```http
POST /api/v1/auth/refresh
```

**Flow:**

1. Access token expires.
2. App uses the refresh token.
3. App sends request to:

```http
POST /api/v1/auth/refresh
```

4. System validates refresh token.
5. System returns a new access token.

**Result:**  
User session continues securely.

---

### Use Case: Logout

**Goal:**  
Allow user or provider to securely log out.

**Endpoint:**

```http
POST /api/v1/auth/logout
```

**Flow:**

1. User selects **Logout**.
2. App sends request to:

```http
POST /api/v1/auth/logout
```

3. System invalidates the refresh token.
4. App clears stored tokens locally.
5. User is redirected to login screen.

**Result:**  
User is logged out and session is invalidated.

---

## 7. Customer Profile Management Flow

### Use Case: View and Update Customer Profile

**Goal:**  
Allow customer to view and update their account information.

**Related Endpoints:**

```http
GET /api/v1/users/me
PATCH /api/v1/users/me
```

**Flow:**

1. Customer logs in.
2. App fetches current profile using:

```http
GET /api/v1/users/me
```

3. Customer edits profile details.
4. App updates profile using:

```http
PATCH /api/v1/users/me
```

5. System saves updated user profile.

**Result:**  
Customer profile is updated.

---

### Use Case: Register Push Notification Token

**Goal:**  
Allow customer to receive push notifications.

**Endpoint:**

```http
POST /api/v1/users/push-tokens
```

**Flow:**

1. Customer logs in on a device.
2. App receives device push token.
3. App registers token using:

```http
POST /api/v1/users/push-tokens
```

4. System stores the token.
5. Customer can receive booking and service updates.

**Result:**  
Push notifications are enabled for the user.

---

### Use Case: Remove Push Notification Token

**Goal:**  
Remove a device from receiving push notifications.

**Endpoint:**

```http
DELETE /api/v1/users/push-tokens/{token}
```

**Flow:**

1. Customer logs out or disables notifications.
2. App sends request to:

```http
DELETE /api/v1/users/push-tokens/{token}
```

3. System removes the push token.

**Result:**  
The device no longer receives notifications.

---

## 8. Provider Profile Management Flow

### Use Case: View and Update Provider Profile

**Goal:**  
Allow provider to manage their profile.

**Related Endpoints:**

```http
GET /api/v1/providers/me
PATCH /api/v1/providers/me
```

**Flow:**

1. Provider logs in.
2. App fetches provider profile using:

```http
GET /api/v1/providers/me
```

3. Provider edits business details, contact info, or profile information.
4. App updates provider profile using:

```http
PATCH /api/v1/providers/me
```

5. System saves the updated provider profile.

**Result:**  
Provider profile is updated.

---

### Use Case: Update Provider Location

**Goal:**  
Allow provider location to be updated for matching and availability.

**Endpoint:**

```http
PATCH /api/v1/providers/me/location
```

**Flow:**

1. Provider logs in.
2. Provider allows location access or manually updates location.
3. App sends new location to:

```http
PATCH /api/v1/providers/me/location
```

4. System saves provider location.
5. Provider can be matched to nearby service requests.

**Result:**  
Provider location is updated.

---

### Use Case: Add Service Category

**Goal:**  
Allow provider to add the services they offer.

**Related Endpoints:**

```http
GET /api/v1/categories
POST /api/v1/providers/me/categories
```

**Flow:**

1. Provider opens service category settings.
2. App loads available categories using:

```http
GET /api/v1/categories
```

3. Provider selects a category.
4. App sends selected category to:

```http
POST /api/v1/providers/me/categories
```

5. System links the provider to that category.

**Result:**  
Provider becomes searchable under that service category.

---

## 9. Service Category Flow

### Use Case: View Service Categories

**Goal:**  
Allow users and providers to view service categories.

**Endpoint:**

```http
GET /api/v1/categories
```

**Flow:**

1. App requests categories using:

```http
GET /api/v1/categories
```

2. System returns all available categories.
3. User or provider selects a category.

**Result:**  
Categories are displayed in the app.

---

### Use Case: Create Service Category

**Goal:**  
Allow an admin or authorized user to create a new service category.

**Endpoint:**

```http
POST /api/v1/categories
```

**Flow:**

1. Authorized user enters category details.
2. App sends request to:

```http
POST /api/v1/categories
```

3. System creates the new category.

**Result:**  
New service category becomes available.

---

### Use Case: View Category Details

**Goal:**  
Allow the system or users to view a specific category.

**Endpoint:**

```http
GET /api/v1/categories/{id}
```

**Flow:**

1. App requests category details using:

```http
GET /api/v1/categories/{id}
```

2. System returns category information.

**Result:**  
Specific category details are displayed.

---

## 10. Customer Service Request Flow

### Use Case: Create Service Request

**Goal:**  
Allow customer to request a service.

**Endpoint:**

```http
POST /api/v1/service-requests
```

**Flow:**

1. Customer logs in.
2. Customer selects a service category.
3. Customer enters service request details, location, schedule, and description.
4. App sends request to:

```http
POST /api/v1/service-requests
```

5. System creates a new service request.
6. System marks the request as open.
7. System can match available providers.

**Result:**  
A new service request is created.

---

### Use Case: View My Service Requests

**Goal:**  
Allow customer to track their own service requests.

**Endpoint:**

```http
GET /api/v1/service-requests/my
```

**Flow:**

1. Customer opens **My Requests**.
2. App requests customer service requests using:

```http
GET /api/v1/service-requests/my
```

3. System returns all service requests created by the customer.

**Result:**  
Customer can see current and previous service requests.

---

### Use Case: Update Service Request Before Acceptance

**Goal:**  
Allow customer to edit a request before a provider accepts it.

**Endpoint:**

```http
PATCH /api/v1/service-requests/{id}
```

**Flow:**

1. Customer opens a pending service request.
2. Customer edits request details.
3. App sends update to:

```http
PATCH /api/v1/service-requests/{id}
```

4. System checks that the request has not been accepted.
5. System updates the request.

**Result:**  
Service request is updated.

---

### Use Case: Cancel Service Request Before Acceptance

**Goal:**  
Allow customer to cancel a request before provider acceptance.

**Endpoint:**

```http
PATCH /api/v1/service-requests/{id}/cancel
```

**Flow:**

1. Customer opens an open service request.
2. Customer selects **Cancel Request**.
3. App sends request to:

```http
PATCH /api/v1/service-requests/{id}/cancel
```

4. System checks that the request has not been accepted.
5. System cancels the service request.

**Result:**  
Service request is cancelled.

---

### Use Case: Match Providers for a Service Request

**Goal:**  
Find providers who can handle the customer’s service request.

**Endpoint:**

```http
GET /api/v1/service-requests/{id}/matches
```

**Flow:**

1. Customer creates or opens a service request.
2. App requests matched providers using:

```http
GET /api/v1/service-requests/{id}/matches
```

3. System checks category, provider availability, location, and profile data.
4. System returns matching providers.

**Result:**  
Customer can see possible providers for the request.

---

## 11. Provider Service Request Flow

### Use Case: Browse Open Requests

**Goal:**  
Allow providers to find available work.

**Related Endpoints:**

```http
GET /api/v1/service-requests/open
GET /api/v1/service-requests/{id}
```

**Flow:**

1. Provider logs in.
2. Provider opens **Open Requests**.
3. App sends request to:

```http
GET /api/v1/service-requests/open
```

4. System returns open service requests relevant to the provider.
5. Provider views service request details using:

```http
GET /api/v1/service-requests/{id}
```

**Result:**  
Provider can browse available service requests.

---

### Use Case: Find Available Providers

**Goal:**  
Allow the system or customer to find providers for a category.

**Endpoint:**

```http
GET /api/v1/providers/available
```

**Flow:**

1. Customer selects a service category.
2. App requests available providers using:

```http
GET /api/v1/providers/available
```

3. System filters providers by category, availability, and location.
4. System returns available providers.

**Result:**  
Available providers are displayed or used for matching.

---

## 12. Booking Flow

### Use Case: Create Booking from Service Request

**Goal:**  
Allow a customer to create a booking after selecting or matching with a provider.

**Endpoint:**

```http
POST /api/v1/bookings
```

**Flow:**

1. Customer creates a service request.
2. Customer views matched providers.
3. Customer selects a provider or confirms booking.
4. App sends booking request to:

```http
POST /api/v1/bookings
```

5. System creates a booking linked to the service request.
6. Booking status is set to `pending`.
7. Provider receives booking notification.

**Result:**  
A booking is created and waits for provider action.

---

### Use Case: Provider Accepts Booking

**Goal:**  
Allow provider to accept a booking.

**Related Endpoints:**

```http
GET /api/v1/bookings/{id}
PATCH /api/v1/bookings/{id}/status
```

**Flow:**

1. Provider receives booking request.
2. Provider opens booking details using:

```http
GET /api/v1/bookings/{id}
```

3. Provider selects **Accept**.
4. App sends status update to:

```http
PATCH /api/v1/bookings/{id}/status
```

5. Request body includes status such as:

```json
{
  "status": "accepted"
}
```

6. System updates booking status.
7. Customer receives notification.

**Result:**  
Booking is accepted and confirmed.

---

### Use Case: Provider Declines Booking

**Goal:**  
Allow provider to decline a booking.

**Endpoint:**

```http
PATCH /api/v1/bookings/{id}/status
```

**Flow:**

1. Provider opens booking details.
2. Provider selects **Decline**.
3. App sends status update to:

```http
PATCH /api/v1/bookings/{id}/status
```

4. Request body includes status such as:

```json
{
  "status": "declined"
}
```

5. System updates booking status.
6. Customer receives notification.
7. Service request may remain open for another provider.

**Result:**  
Booking is declined and customer can continue searching.

---

### Use Case: Start Booking

**Goal:**  
Allow provider to indicate that service has started.

**Endpoint:**

```http
PATCH /api/v1/bookings/{id}/status
```

**Flow:**

1. Provider arrives or begins service.
2. Provider selects **Start Job**.
3. App sends status update to:

```http
PATCH /api/v1/bookings/{id}/status
```

4. Request body includes status such as:

```json
{
  "status": "started"
}
```

5. System updates booking status.
6. Customer is notified.

**Result:**  
Booking status becomes active or in progress.

---

### Use Case: Complete Booking

**Goal:**  
Allow provider to mark the service as completed.

**Endpoint:**

```http
PATCH /api/v1/bookings/{id}/status
```

**Flow:**

1. Provider finishes the job.
2. Provider selects **Complete Job**.
3. App sends status update to:

```http
PATCH /api/v1/bookings/{id}/status
```

4. Request body includes status such as:

```json
{
  "status": "completed"
}
```

5. System updates booking status.
6. Customer receives completion notification.
7. Payment and invoice flow can be finalized.

**Result:**  
Booking is completed.

---

### Use Case: Cancel Booking

**Goal:**  
Allow a booking to be cancelled where allowed.

**Endpoint:**

```http
PATCH /api/v1/bookings/{id}/status
```

**Flow:**

1. Customer or provider opens booking details.
2. User selects **Cancel Booking**.
3. App sends status update to:

```http
PATCH /api/v1/bookings/{id}/status
```

4. Request body includes status such as:

```json
{
  "status": "cancelled"
}
```

5. System checks whether cancellation is allowed.
6. System updates booking status.
7. Other party receives notification.

**Result:**  
Booking is cancelled.

---

### Use Case: View My Bookings

**Goal:**  
Allow customer or provider to view their bookings.

**Endpoint:**

```http
GET /api/v1/bookings/my
```

**Flow:**

1. Logged-in customer or provider opens bookings page.
2. App requests bookings using:

```http
GET /api/v1/bookings/my
```

3. System returns bookings linked to the current account.

**Result:**  
User can view all their bookings.

---

## 13. Payment Flow

### Use Case: View Payment Breakdown

**Goal:**  
Allow customer to see the cost breakdown before paying.

**Endpoint:**

```http
GET /api/v1/payments/breakdown/{bookingId}
```

**Flow:**

1. Customer opens booking payment page.
2. App requests payment breakdown using:

```http
GET /api/v1/payments/breakdown/{bookingId}
```

3. System calculates service cost, platform fees, taxes, and total amount.
4. App displays the payment breakdown.

**Result:**  
Customer sees how much they need to pay.

---

### Use Case: Initiate PayFast Payment

**Goal:**  
Allow customer to pay for a booking.

**Related Endpoints:**

```http
POST /api/v1/payments/payfast/initiate/{bookingId}
POST /api/v1/payments/payfast/itn
```

**Flow:**

1. Customer confirms payment.
2. App sends payment initiation request to:

```http
POST /api/v1/payments/payfast/initiate/{bookingId}
```

3. System creates a PayFast payment session.
4. Customer is redirected to PayFast.
5. Customer completes payment.
6. PayFast sends payment confirmation to:

```http
POST /api/v1/payments/payfast/itn
```

7. System validates the PayFast ITN.
8. System updates payment status.
9. Booking payment is marked as paid.

**Result:**  
Booking payment is completed.

---

### Use Case: View Payment History

**Goal:**  
Allow customer or provider to view previous transactions.

**Endpoint:**

```http
GET /api/v1/payments/history
```

**Flow:**

1. User opens payment history.
2. App sends request to:

```http
GET /api/v1/payments/history
```

3. System returns payment records linked to the account.

**Result:**  
User can view transaction history.

---

## 14. Full Customer Journey Flow

1. Customer registers using:

```http
POST /api/v1/auth/register
```

2. Customer verifies email or phone using:

```http
POST /api/v1/auth/verify-email
POST /api/v1/auth/verify-phone
```

3. Customer logs in using:

```http
POST /api/v1/auth/login
```

4. Customer views or updates profile using:

```http
GET /api/v1/users/me
PATCH /api/v1/users/me
```

5. Customer views service categories using:

```http
GET /api/v1/categories
```

6. Customer creates a service request using:

```http
POST /api/v1/service-requests
```

7. System finds matches using:

```http
GET /api/v1/service-requests/{id}/matches
```

8. Customer creates a booking using:

```http
POST /api/v1/bookings
```

9. Provider accepts or declines booking using:

```http
PATCH /api/v1/bookings/{id}/status
```

10. Customer views booking updates using:

```http
GET /api/v1/bookings/my
GET /api/v1/bookings/{id}
```

11. Customer views payment breakdown using:

```http
GET /api/v1/payments/breakdown/{bookingId}
```

12. Customer pays using:

```http
POST /api/v1/payments/payfast/initiate/{bookingId}
```

13. System receives PayFast confirmation using:

```http
POST /api/v1/payments/payfast/itn
```

14. Customer views payment history using:

```http
GET /api/v1/payments/history
```

---

## 15. Full Provider Journey Flow

1. Provider registers using:

```http
POST /api/v1/auth/provider/register
```

2. Provider verifies email or phone using:

```http
POST /api/v1/auth/verify-email
POST /api/v1/auth/verify-phone
```

3. Provider logs in using:

```http
POST /api/v1/auth/provider/login
```

4. Provider views or updates profile using:

```http
GET /api/v1/providers/me
PATCH /api/v1/providers/me
```

5. Provider updates location using:

```http
PATCH /api/v1/providers/me/location
```

6. Provider views service categories using:

```http
GET /api/v1/categories
```

7. Provider adds service category using:

```http
POST /api/v1/providers/me/categories
```

8. Provider browses open requests using:

```http
GET /api/v1/service-requests/open
```

9. Provider views request details using:

```http
GET /api/v1/service-requests/{id}
```

10. Provider receives booking request.
11. Provider views booking using:

```http
GET /api/v1/bookings/{id}
```

12. Provider accepts, declines, starts, completes, or cancels booking using:

```http
PATCH /api/v1/bookings/{id}/status
```

13. Provider views all bookings using:

```http
GET /api/v1/bookings/my
```

14. Provider views payment history using:

```http
GET /api/v1/payments/history
```

---

## 16. Booking Status Lifecycle

The booking can move through the following status flow:

```text
pending → accepted → started → completed
```

Alternative flows:

```text
pending → declined
pending → cancelled
accepted → cancelled
```

The status is updated using:

```http
PATCH /api/v1/bookings/{id}/status
```

Possible status actions:

- `accept`
- `decline`
- `start`
- `complete`
- `cancel`

---

## 17. Suggested App Screen Flow

### Customer Screens

1. Welcome Screen
2. Login Screen
3. Register Screen
4. Email/Phone Verification Screen
5. 2FA Verification Screen
6. Home Screen
7. Categories Screen
8. Create Service Request Screen
9. Matched Providers Screen
10. Booking Confirmation Screen
11. My Bookings Screen
12. Booking Details Screen
13. Payment Breakdown Screen
14. PayFast Payment Screen
15. Payment History Screen
16. Profile Screen
17. Settings and Logout Screen

### Provider Screens

1. Welcome Screen
2. Provider Login Screen
3. Provider Register Screen
4. Email/Phone Verification Screen
5. 2FA Verification Screen
6. Provider Dashboard
7. Provider Profile Screen
8. Service Categories Screen
9. Update Location Screen
10. Open Requests Screen
11. Service Request Details Screen
12. Booking Request Screen
13. Booking Details Screen
14. Active Job Screen
15. Completed Jobs Screen
16. Payment History Screen
17. Settings and Logout Screen

---

## 18. High-Level System Flow

1. User or provider authenticates.
2. Account is verified through email, phone, or 2FA.
3. Customer creates a service request.
4. System matches the request with available providers.
5. Customer creates a booking.
6. Provider accepts or declines the booking.
7. If accepted, the provider starts and completes the service.
8. Customer makes payment through PayFast.
9. System receives PayFast ITN confirmation.
10. Booking and payment records are updated.
11. Customer and provider can view history.

---

# Part 2: Admin and Manager Operations

## 1. Main Actors

### Admin / Manager

The admin or manager is responsible for managing users, providers, KYC approvals, suspensions, withdrawals, and financial reporting.

### Provider

The provider may submit KYC information, request withdrawals, and be approved, rejected, suspended, or unsuspended by the admin.

### Customer/User

The customer can be viewed, searched, suspended, or unsuspended by the admin if necessary.

### System

The system stores users, providers, KYC records, withdrawal requests, and financial report data. It also enforces admin permissions.

---

## 2. Admin Login Requirement

Before accessing admin features, the admin must already be authenticated and authorized.

**Flow:**

1. Admin logs into the system.
2. System checks whether the logged-in account has admin or manager permissions.
3. If authorized, the admin can access the admin dashboard.
4. If not authorized, access is denied.

**Result:**  
Only authorized admins or managers can access admin operations.

---

## 3. User Management Flow

### Use Case: List All Users

**Goal:**  
Allow admin to view all registered users with search and pagination.

**Endpoint:**

```http
GET /api/v1/admin/users
```

**Flow:**

1. Admin opens the **User Management** page.
2. App sends request to:

```http
GET /api/v1/admin/users
```

3. System returns a paginated list of users.
4. Admin can search by name, email, phone number, status, or role.
5. Admin can select a user to view more details.

**Result:**  
Admin can monitor and manage customer accounts.

---

### Use Case: Suspend or Ban a User

**Goal:**  
Allow admin to suspend or ban a user account for policy violations, fraud, abuse, or security reasons.

**Endpoint:**

```http
PATCH /api/v1/admin/users/{id}/suspend
```

**Flow:**

1. Admin opens the **User Management** page.
2. Admin searches for a specific user.
3. Admin opens the user profile.
4. Admin selects **Suspend User** or **Ban User**.
5. Admin may enter a reason for suspension.
6. App sends request to:

```http
PATCH /api/v1/admin/users/{id}/suspend
```

7. System updates the user account status.
8. The user is prevented from accessing restricted features.
9. System may notify the user about the suspension.

**Result:**  
User account is suspended or banned.

---

### Use Case: Unsuspend a User

**Goal:**  
Allow admin to restore a suspended user account.

**Endpoint:**

```http
PATCH /api/v1/admin/users/{id}/unsuspend
```

**Flow:**

1. Admin opens the **User Management** page.
2. Admin filters or searches for suspended users.
3. Admin opens the suspended user profile.
4. Admin selects **Unsuspend User**.
5. App sends request to:

```http
PATCH /api/v1/admin/users/{id}/unsuspend
```

6. System updates the user account status back to active.
7. The user regains access to allowed system features.

**Result:**  
Suspended user account is restored.

---

## 4. Provider Management Flow

### Use Case: List All Providers

**Goal:**  
Allow admin to view all registered providers with search and pagination.

**Endpoint:**

```http
GET /api/v1/admin/providers
```

**Flow:**

1. Admin opens the **Provider Management** page.
2. App sends request to:

```http
GET /api/v1/admin/providers
```

3. System returns a paginated list of providers.
4. Admin can search by provider name, email, phone, category, KYC status, availability, or account status.
5. Admin selects a provider to view full profile details.

**Result:**  
Admin can monitor and manage provider accounts.

---

### Use Case: Suspend or Ban a Provider

**Goal:**  
Allow admin to suspend or ban a provider due to misconduct, failed compliance, fraud, poor service, or platform policy violations.

**Endpoint:**

```http
PATCH /api/v1/admin/providers/{id}/suspend
```

**Flow:**

1. Admin opens the **Provider Management** page.
2. Admin searches for the provider.
3. Admin opens the provider profile.
4. Admin selects **Suspend Provider** or **Ban Provider**.
5. Admin may enter a reason for the suspension.
6. App sends request to:

```http
PATCH /api/v1/admin/providers/{id}/suspend
```

7. System updates the provider account status.
8. Provider is prevented from receiving new service requests or bookings.
9. System may notify the provider about the suspension.

**Result:**  
Provider account is suspended or banned.

---

### Use Case: Unsuspend a Provider

**Goal:**  
Allow admin to restore a suspended provider account.

**Endpoint:**

```http
PATCH /api/v1/admin/providers/{id}/unsuspend
```

**Flow:**

1. Admin opens the **Provider Management** page.
2. Admin filters or searches for suspended providers.
3. Admin opens the provider profile.
4. Admin selects **Unsuspend Provider**.
5. App sends request to:

```http
PATCH /api/v1/admin/providers/{id}/unsuspend
```

6. System updates the provider account status to active.
7. Provider can access provider features again.
8. Provider may become available for service matching again.

**Result:**  
Suspended provider account is restored.

---

## 5. Provider KYC Management Flow

### Use Case: Review Provider KYC

**Goal:**  
Allow admin to review provider verification documents before allowing the provider to operate fully on the platform.

**Related Endpoints:**

```http
GET /api/v1/admin/providers
PATCH /api/v1/admin/kyc/{id}/approve
PATCH /api/v1/admin/kyc/{id}/reject
```

**Flow:**

1. Admin opens the **KYC Review** section.
2. Admin views providers with pending KYC status.
3. App may fetch providers using:

```http
GET /api/v1/admin/providers
```

4. Admin opens a provider’s KYC submission.
5. Admin reviews documents, business details, identity information, service category, and compliance status.
6. Admin decides whether to approve or reject the KYC submission.

**Result:**  
Admin can make a KYC decision for a provider.

---

### Use Case: Approve Provider KYC

**Goal:**  
Allow admin to approve a provider after successful verification.

**Endpoint:**

```http
PATCH /api/v1/admin/kyc/{id}/approve
```

**Flow:**

1. Admin opens a provider’s pending KYC record.
2. Admin checks submitted documents and profile details.
3. Admin selects **Approve KYC**.
4. App sends request to:

```http
PATCH /api/v1/admin/kyc/{id}/approve
```

5. System updates the provider KYC status to approved.
6. Provider account becomes verified.
7. Provider may now receive bookings or become visible in provider matching.
8. System may notify the provider that KYC has been approved.

**Result:**  
Provider KYC is approved and provider becomes verified.

---

### Use Case: Reject Provider KYC

**Goal:**  
Allow admin to reject a provider KYC submission if documents are invalid, incomplete, expired, or do not meet platform requirements.

**Endpoint:**

```http
PATCH /api/v1/admin/kyc/{id}/reject
```

**Flow:**

1. Admin opens a provider’s pending KYC record.
2. Admin reviews the submitted documents.
3. Admin selects **Reject KYC**.
4. Admin enters a rejection reason.
5. App sends request to:

```http
PATCH /api/v1/admin/kyc/{id}/reject
```

6. System updates the KYC status to rejected.
7. Provider may be blocked from receiving bookings until KYC is corrected.
8. System notifies the provider with the rejection reason.
9. Provider may be allowed to resubmit KYC documents.

**Result:**  
Provider KYC is rejected and provider must correct or resubmit information.

---

## 6. Withdrawal Management Flow

### Use Case: View Pending Withdrawals

**Goal:**  
Allow admin to view provider withdrawal requests that are waiting for approval.

**Endpoint:**

```http
GET /api/v1/admin/withdrawals/pending
```

**Flow:**

1. Admin opens the **Withdrawals** page.
2. App sends request to:

```http
GET /api/v1/admin/withdrawals/pending
```

3. System returns all pending withdrawal requests.
4. Admin can view provider name, amount, date requested, banking details, wallet balance, and withdrawal status.
5. Admin selects a withdrawal request for review.

**Result:**  
Admin can review pending withdrawal requests.

---

### Use Case: Approve Withdrawal

**Goal:**  
Allow admin to approve a valid provider withdrawal request.

**Endpoint:**

```http
PATCH /api/v1/admin/withdrawals/{id}/approve
```

**Flow:**

1. Admin opens a pending withdrawal request.
2. Admin checks provider wallet balance, transaction history, payout details, and fraud indicators.
3. Admin selects **Approve Withdrawal**.
4. App sends request to:

```http
PATCH /api/v1/admin/withdrawals/{id}/approve
```

5. System updates the withdrawal status to approved.
6. System may trigger payout processing.
7. Provider wallet balance is adjusted if not already reserved.
8. Provider is notified that the withdrawal was approved.

**Result:**  
Withdrawal request is approved.

---

### Use Case: Reject Withdrawal

**Goal:**  
Allow admin to reject an invalid or suspicious withdrawal request.

**Endpoint:**

```http
PATCH /api/v1/admin/withdrawals/{id}/reject
```

**Flow:**

1. Admin opens a pending withdrawal request.
2. Admin reviews the withdrawal details.
3. Admin identifies an issue, such as insufficient balance, incorrect banking details, suspicious activity, or policy violation.
4. Admin selects **Reject Withdrawal**.
5. Admin enters a rejection reason.
6. App sends request to:

```http
PATCH /api/v1/admin/withdrawals/{id}/reject
```

7. System updates the withdrawal status to rejected.
8. Funds remain in the provider wallet or are released back if they were reserved.
9. Provider is notified of the rejection reason.

**Result:**  
Withdrawal request is rejected.

---

## 7. Financial Reports and Analytics Flow

### Use Case: View Financial Reports

**Goal:**  
Allow admin or manager to view platform financial performance and analytics.

**Endpoint:**

```http
GET /api/v1/admin/reports/financial
```

**Flow:**

1. Admin opens the **Financial Reports** page.
2. App sends request to:

```http
GET /api/v1/admin/reports/financial
```

3. System returns financial report data.
4. Admin views key metrics such as:
   - Total revenue
   - Completed payments
   - Pending payments
   - Provider payouts
   - Platform fees
   - Refunds
   - Withdrawal totals
   - Revenue by date range
   - Revenue by service category
5. Admin may filter reports by date, category, provider, payment status, or transaction type.

**Result:**  
Admin can monitor platform financial health.

---

## 8. Technical Support and Monitoring Flow

### Use Case: Monitor Platform Activity

**Goal:**  
Allow support or admin staff to monitor users, providers, withdrawals, KYC status, and financial activity.

**Related Endpoints:**

```http
GET /api/v1/admin/users
GET /api/v1/admin/providers
GET /api/v1/admin/withdrawals/pending
GET /api/v1/admin/reports/financial
```

**Flow:**

1. Admin or support staff opens the monitoring dashboard.
2. System displays important operational data.
3. Admin checks user growth, provider activity, pending KYC records, pending withdrawals, and financial activity.
4. Admin identifies issues that require action.
5. Admin performs actions such as suspending accounts, approving KYC, rejecting KYC, approving withdrawals, or rejecting withdrawals.

**Result:**  
Admin can manage and monitor platform operations.

---

## 9. Full Admin Journey Flow

1. Admin logs in and accesses the admin dashboard.
2. Admin views all users using:

```http
GET /api/v1/admin/users
```

3. Admin searches, filters, or paginates users.
4. If a user violates rules, admin suspends the user using:

```http
PATCH /api/v1/admin/users/{id}/suspend
```

5. If the user is cleared, admin restores the account using:

```http
PATCH /api/v1/admin/users/{id}/unsuspend
```

6. Admin views all providers using:

```http
GET /api/v1/admin/providers
```

7. Admin reviews provider profile and KYC status.
8. Admin approves provider KYC using:

```http
PATCH /api/v1/admin/kyc/{id}/approve
```

9. Or admin rejects provider KYC using:

```http
PATCH /api/v1/admin/kyc/{id}/reject
```

10. If a provider violates rules, admin suspends the provider using:

```http
PATCH /api/v1/admin/providers/{id}/suspend
```

11. If the provider is cleared, admin restores the provider using:

```http
PATCH /api/v1/admin/providers/{id}/unsuspend
```

12. Admin views pending withdrawal requests using:

```http
GET /api/v1/admin/withdrawals/pending
```

13. Admin approves a valid withdrawal using:

```http
PATCH /api/v1/admin/withdrawals/{id}/approve
```

14. Admin rejects an invalid withdrawal using:

```http
PATCH /api/v1/admin/withdrawals/{id}/reject
```

15. Admin views financial analytics using:

```http
GET /api/v1/admin/reports/financial
```

16. Admin uses the reports to monitor platform revenue, payments, payouts, and financial performance.

---

## 10. Admin Screen Flow

### Admin Screens

1. Admin Login Screen
2. Admin Dashboard
3. User Management Screen
4. User Details Screen
5. Provider Management Screen
6. Provider Details Screen
7. KYC Review Screen
8. Withdrawal Requests Screen
9. Withdrawal Details Screen
10. Financial Reports Screen
11. Support and Monitoring Screen
12. Settings and Logout Screen

---

## 11. Admin Dashboard Modules

### User Management

Used to search, view, suspend, and unsuspend customers.

### Provider Management

Used to search, view, suspend, and unsuspend service providers.

### KYC Management

Used to approve or reject provider verification submissions.

### Withdrawal Management

Used to approve or reject provider payout requests.

### Financial Reporting

Used to view platform revenue, transaction activity, payouts, and financial analytics.

### Support and Monitoring

Used to monitor platform activity, detect issues, and support operational decision-making.

---

## 12. Admin Status Lifecycle

### User Account Status

```text
active → suspended
active → banned
suspended → active
```

The status is updated using:

```http
PATCH /api/v1/admin/users/{id}/suspend
PATCH /api/v1/admin/users/{id}/unsuspend
```

### Provider Account Status

```text
active → suspended
active → banned
suspended → active
```

The status is updated using:

```http
PATCH /api/v1/admin/providers/{id}/suspend
PATCH /api/v1/admin/providers/{id}/unsuspend
```

### Provider KYC Status

```text
pending → approved
pending → rejected
```

The status is updated using:

```http
PATCH /api/v1/admin/kyc/{id}/approve
PATCH /api/v1/admin/kyc/{id}/reject
```

### Withdrawal Status

```text
pending → approved
pending → rejected
```

The status is updated using:

```http
PATCH /api/v1/admin/withdrawals/{id}/approve
PATCH /api/v1/admin/withdrawals/{id}/reject
```

---

## 13. High-Level Admin System Flow

1. Admin accesses the dashboard.
2. Admin monitors users and providers.
3. Admin reviews provider KYC submissions.
4. Admin approves or rejects KYC.
5. Admin manages account suspensions.
6. Admin reviews pending withdrawal requests.
7. Admin approves or rejects withdrawals.
8. Admin views financial reports.
9. Admin uses support and monitoring tools to maintain platform safety, compliance, and financial control.
