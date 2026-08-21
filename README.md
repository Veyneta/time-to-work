# time to work




Static local-first prototype for time attendance, user management, GPS geofencing, selfie verification, reports, and admin tools.

## What is included

- Multi-store accounts: register multiple stores with store name, owner email, and password; each store has isolated users, settings, and logs
- User Management: add, edit, disable, and delete employees; admin and employee roles; PIN login
- Clock In / Clock Out: automatic timestamping, duplicate prevention, current user session
- GPS + Geofencing: browser geolocation and distance checks against store coordinates
- Extra verification: selfie upload/capture before clocking in or out
- Reports: daily/monthly summaries, late minutes, OT, CSV/JSON export
- Admin Dashboard: active staff view, store settings, manual time adjustments, check-in map

## How to run

This app is plain HTML, CSS, and JavaScript. Open it from a local web server so browser geolocation works correctly.

If you are on Windows and do not have Node.js or Python installed, you can use a local preview extension in VS Code or serve the folder with any lightweight HTTP server you already have available.

## Demo accounts

- Admin: `Admin` / PIN `1234`
- Employee: `Mook` / PIN `2468`
- Employee: `Natt` / PIN `1357`

## Notes

- Data is stored in `localStorage` and `sessionStorage`. This prototype stores registration passwords locally; use a real backend with hashed passwords for production.
- GPS access requires HTTPS or localhost.
- Exported CSV files can be opened in Excel.
