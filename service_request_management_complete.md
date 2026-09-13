# Service Request Management Completion

## Summary
The service request management endpoints are implemented and appear to satisfy the acceptance criteria for issue #1.

## Completed endpoints
- `POST /api/v1/service-requests` — create a service request
- `GET /api/v1/service-requests/{id}` — view full request details
- `PATCH /api/v1/service-requests/{id}` — update a service request before it is accepted
- `PATCH /api/v1/service-requests/{id}/cancel` — cancel a service request before it is accepted
- `GET /api/v1/service-requests/open` — list active open requests for providers
- `GET /api/v1/service-requests/my` — list the current user’s service requests

## What is covered
- Customers can create service requests with category, description, date/time, and location.
- Customers can view detailed information for one service request.
- Customers can update a request while it is still open and has not been accepted.
- Customers can cancel a request before it is accepted.
- Providers can view full details of open requests through the open request listing.
- Cancelled requests are excluded from the open request list.
- Proper authorization checks are in place so only the request owner can update or cancel their request.
- The service returns appropriate errors for invalid, unauthorized, or already accepted requests.

## Notes
- Soft cancellation is used instead of permanent deletion.
- Open requests are filtered by `isActive = true`.
- Request creation validates the supplied category ID.
- Request details include related category and user data.
