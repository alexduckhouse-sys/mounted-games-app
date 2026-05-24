# MG App - Product Details

I am building a Mounted Games competition management app, called the MG app.

It is a full-stack app with a React/Vite frontend and a C# ASP.NET backend API, likely using SQLite or similar for storage.

The app is for running Mounted Games competitions live. It should help organisers, trainers, and possibly riders manage sessions, teams, declaration forms, scoring, race order, arena status, chat updates, and competition history.

## Main purpose

The MG app should make it easy to run a Mounted Games event from one place. It should replace paper-based scoring/timetables with a smooth live dashboard.

## Core users

1. **Organisers/admins**
   - Create and manage competitions
   - Set up sessions
   - Manage arenas/timetables
   - Add teams and riders
   - Enter results live
   - Publish updates

2. **Trainers**
   - Have their own login
   - View their teams
   - Submit declaration forms
   - See past competitions
   - Have a notes page
   - View details about their team/riders

3. **Riders/teams**
   - Rider profiles were removed, so the focus is more on teams and trainers rather than individual rider profile pages.

## Important features

- Login system with different user types, especially trainer login.
- Home dashboard with large clear buttons/cards.
- Slick modern UI with smooth animations and nicer icons.
- More colour options/themes.

### Sessions/timetable system
- The app should use "sessions" rather than individual race timetable entries.
- Sessions can show whether they are in the arena, upcoming, or finished.
- In-arena sessions should be yellow.
- Finished sessions should be green.

### Race management
- It does not need to pick exact race times automatically.
- It should show what races are currently in the arena/session.
- The user wanted a table of races/results.

### Live scoring
- Scoring should be very fast for live use.
- Instead of entering points one team at a time, the user should be able to click teams in finishing order and update all points at once.
- Buttons should be large and easy to tap.
- There should be an elimination option worth 0 points.
- Elimination could be done by holding or swiping a team button.
- Points/results should be shown in a table.

### Declaration forms
- Trainers should be able to submit declaration forms.
- Adding riders to declaration forms should feel like the earlier version: easy and form-based, not clunky.

### Chat/updates
- Chat should work like a proper live competition chat.
- Once someone joins, they should see updates to timings, sessions, arena info, announcements, etc.
- It should feel like a real event update feed/chat, not just a basic message box.

### Weather
- Weather icon should show the actual weather if possible.

### UI design
- Overall UI should be slick, colourful, smooth, and easy to use.
- Use nicer icons.
- Use animations/smoother transitions.
- Make it look polished and practical for real outdoor competition use.
- Avoid tiny controls; many parts should be tap-friendly.

## Recent issue

What I want next:

Continue building the final MG app project. Make sure it has:
- React frontend
- C# backend API
- Proper data models for users, trainers, teams, sessions, declaration forms, chat messages, results, and competitions
- A polished UI
- Working live scoring
- Trainer login/dashboard
- Session timetable/status system
- Live chat/update feed
- Declaration form submission
- Weather display if possible

Do not worry about line count. Focus on making the app complete, usable, and good-looking.
