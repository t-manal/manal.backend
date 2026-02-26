# Admin API Specification & Project Overview

**Deliverable for**: Admin Frontend Developer
**Generated**: 2026-01-09
**Based on**: Current Backend Implementation

---

# 1. Project Overview

## Platform Summary

This is a **Single-Instructor Course Marketplace LMS**.

- **Users**:
  - **Student**: Browses catalog, buys courses, watches content, tracks progress, requests certificates.
  - **Instructor (Admin)**: Manages catalog, tracks sales, supports students, issues certificates.
- **Content Hierachy**: University -> Major -> Subject -> Course -> Section -> Lesson -> Asset (Video/PDF/Quiz).
- **Media**:
  - Videos hosted/streamed via **Bunny.net Stream** (HLS).
  - PDFs/Images hosted via **Bunny.net Storage** (CDN).

## Main User Flows

1. **Browse & Search**: Public catalog (University -> Major -> Subject -> Course).
2. **Purchase**: Stripe/Checkout -> Enrollment created -> Payment Record stored.
3. **Learning**: Access content tree -> Watch video (signed token) / Download PDF -> Update progress.
4. **Certification**: Complete all lessons -> Request Certificate -> Admin approves -> Certificate Issued.
5. **Engagement**: Rate courses, Open support tickets (Instructor replies).

## Data Model Summary

- **Catalog**: `University`, `Major`, `Subject` (Static structure).
- **Course**: `Course` (metadata, price), `CourseSection`, `Lesson`, `LessonAsset`.
- **Sales**: `Enrollment` (Active/Expired), `Payment` (Record of transaction), `Coupon` (Discounts).
- **Support**: `SupportTicket`, `TicketMessage` (Threaded conversation).
- **Feedback**: `Rating` (1-5 stars + review).
- **Certificates**: `Certificate` (Request/Issued/Rejected).

---

# 2. API Conventions

- **Base URL**: `http://localhost:4000/api/v1` (adjust domain in prod).
- **Authentication**:
  - Header: `Authorization: Bearer <access_token>`
  - **Refresh Token**: Handled via HTTP-only cookie (`refresh_token`), endpoint `/auth/refresh`.
- **Response Format**:
    All responses follow the `ApiResponse` wrapper.
    **Success**:

    ```json
    {
      "success": true,
      "message": "Operation successful",
      "data": { ... }
    }
    ```

    **Error**:

    ```json
    {
      "success": false,
      "message": "Error description",
      "error": "ERROR_CODE_OR_DETAILS"
    }
    ```

- **Pagination**: Use `page` (default 1) and `limit` (default 10/20) in query params.
- **IDs**: All IDs are **UUIDs** (String).

---

# 3. Admin (Instructor) APIs

These endpoints are for the **Admin Dashboard**.
**Role Required**: `INSTRUCTOR`
**Auth Required**: Yes

## A. Instructor Content Management

**Base Path**: `/api/v1/instructor`

| Method | Path | Purpose | Request Body / Query |
| :--- | :--- | :--- | :--- |
| **POST** | `/courses` | Create new course | Body: `CreateCourseInput` (see below) |
| **PATCH** | `/courses/:id` | Update course details | Body: `UpdateCourseInput` |
| **POST** | `/courses/:courseId/sections` | Create Section | Body: `{ "title": "Intro", "order": 1 }` |
| **PATCH** | `/sections/:id` | Update Section | Body: `{ "title": "New Title", "order": 2 }` |
| **DELETE** | `/sections/:id` | Delete Section | - |
| **POST** | `/sections/:sectionId/lessons` | Create Lesson | Body: `{ "title": "Lesson 1", "order": 1 }` |
| **PATCH** | `/lessons/:id` | Update Lesson | Body: `{ "title": "Updated", "order": 2 }` |
| **DELETE** | `/lessons/:id` | Delete Lesson | - |
| **POST** | `/lessons/:lessonId/assets` | Add Asset (Video/PDF) | Body: `CreateAssetInput` |
| **PATCH** | `/assets/:id` | Update Asset | Body: `UpdateAssetInput` |
| **DELETE** | `/assets/:id` | Delete Asset | - |

**Schemas**:

**CreateCourseInput**:

```json
{
  "title": "Course Name",
  "slug": "course-slug",
  "description": "Optional description",
  "price": 99.99,
  "subjectId": "UUID",
  "isPublished": false,
  "isFeatured": false,
  "isFree": false,
  "trailerAssetId": "UUID (optional)"
}
```

**CreateAssetInput**:

```json
{
  "title": "Video Title",
  "type": "VIDEO" | "PDF" | "QUIZ" | "ARTICLE",
  "isPreview": false,
  "order": 1,
  "bunnyVideoId": "uuid-from-bunny",
  "storageKey": "path/file.pdf",
  "quizId": "uuid-optional"
}
```

## B. Uploads

**Base Path**: `/api/v1`

**Note**: All uploads use `multipart/form-data`. field name: `file`.

1. **Upload Course Thumbnail**
    - **POST** `/courses/:courseId/thumbnail`
    - **Constraints**: Image (jpg/png/webp), Max 5MB.
2. **Upload User Avatar**
    - **POST** `/users/me/avatar`
    - **Constraints**: Image (jpg/png/webp), Max 5MB.
3. **Upload Lesson PDF**
    - **POST** `/lessons/:lessonId/pdf`
    - **Body**: `title` (text, optional).
    - **Constraints**: Document upload (PDF/PPT/PPTX/DOC/DOCX/TXT), Max 100MB.
4. **Get Lesson PDF** (Secure Stream)
    - **GET** `/lessons/:lessonId/pdf`
    - **Returns**: Binary stream (application/pdf).

## C. Support (Instructor Inbox)

**Base Path**: `/api/v1/instructor/support`

1. **List Tickets**
    - **GET** `/tickets?page=1&limit=10&status=OPEN`
    - **Params**: `status` (OPEN, CLOSED, RESOLVED).
2. **Get Ticket Details**
    - **GET** `/tickets/:id`
    - **Returns**: Ticket details + Message history.
3. **Reply to Ticket**
    - **POST** `/tickets/:id/messages`
    - **Body**: `{ "message": "Here is the solution..." }`
4. **Update Status**
    - **PATCH** `/tickets/:id`
    - **Body**: `{ "status": "RESOLVED" }`

## D. Coupons

**Base Path**: `/api/v1/instructor/coupons`

1. **Create Coupon**
    - **POST** `/`
    - **Body**:

        ```json
        {
          "code": "SUMMER2024",
          "discountType": "PERCENTAGE" | "FIXED",
          "value": 20,
          "courseId": "UUID (optional, global if null)",
          "isActive": true,
          "maxRedemptions": 100
        }
        ```

2. **List Coupons**
    - **GET** `/?courseId=UUID&page=1`
3. **Update Coupon**
    - **PATCH** `/:id`
    - **Body**: Partial of Create Coupon.

## E. Payments

**Base Path**: `/api/v1/instructor/payments`

1. **List Payments**
    - **GET** `/?page=1&limit=20&status=COMPLETED&provider=STRIPE&courseId=UUID`
    - **Filter**: `status` (PENDING, COMPLETED, FAILED, REFUNDED), `provider` (STRIPE, PAYPAL).

## F. Certificates

**Base Path**: `/api/v1/certificates/instructor`

1. **List Pending Requests**
    - **GET** `/pending`
    - **Returns**: List of certificates where status = PENDING.
2. **Update Status (Issue/Reject)**
    - **PATCH** `/:id`
    - **Body**: `{ "status": "ISSUED" | "REJECTED" }`
    - **Logic**: System checks if user completed all content before issuing.

## G. Ratings

**Base Path**: `/api/v1`

1. **List Course Ratings**
    - **GET** `/instructor/courses/:courseId/ratings`
    - **Purpose**: View feedback and stars for a specific course.

---

# 4. Student/Public APIs (For Admin Re-use)

The Admin Frontend may need to drill down into "User View" or use common utilities.

## Auth (Shared) - `/api/v1/auth`

- **POST** `/login`: Email/Password login.
- **POST** `/refresh`: Refresh access token (cookie based).
- **GET** `/me`: Get current user details and role.
- **POST** `/logout`: Clear cookies.

## Catalog (Public) - `/api/v1/catalog`

- **GET** `/universities`: List all universities.
- **GET** `/universities/:id/majors`: Drill down.
- **GET** `/majors/:id/subjects`: Drill down.
- **GET** `/subjects/:id/courses`: Drill down.
- *Note: Instructor assigns courses to these existing subject IDs.*

## Student Content - `/api/v1/courses`

- **GET** `/:id`: Public course details.
- **GET** `/:id/content`: Full syllabus (tree).
- **GET** `/:courseId/lessons/:lessonId/playback`: Get video signed token (if enrolled/preview).

---

# 5. Missing / Planned Endpoints (GAPS)

**NOT IMPLEMENTED in Backend yet:**

1. **Catalog Management**:
    - Cannot create/edit Universities, Majors, or Subjects via API.
    - *Current State*: These are expected to be seeded in DB or managed via direct DB access.
2. **Site Settings**:
    - No endpoint to update site title, logos, or global config.
3. **Analytics/Dashboard**:
    - No aggregate stats endpoint (e.g., "Total Revenue", "Daily Active Users").
    - *Workaround*: Frontend must calculate from `/payments` list.
4. **User Management**:
    - No "List All Students" endpoint for Admin to ban/manage users directly.

---

# 6. Quick Frontend Integration Notes

1. **Auth Flow**:
    - On 401 Unauthorized: Call `/api/v1/auth/refresh`.
    - If Refresh fails (401/403): Redirect to Login.
    - Store Access Token in **Memory** (Context/State), not LocalStorage (security).
2. **File Uploads**:
    - Use `FormData`.
    - Check `file.size` before sending (save bandwidth).
3. **Video Upload**:
    - The API expects `bunnyVideoId`. The frontend likely needs to upload the video *directly* to Bunny.net (using their Tus protocol or API) and then send the resulting ID to our Backend.
    - *Clarification needed*: Does the backend proxy upload? Currently, `Asset` creation schema implies we just save the ID (`bunnyVideoId`).
4. **PDF Protection**:
    - Never link directly to PDF URL. Use the `/lessons/:id/pdf` stream endpoint.
