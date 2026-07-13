# Isobar Weather Dashboard

A lightweight weather dashboard built with Express and the WeatherAI API. It provides current weather, a short AI summary, a 24-hour forecast view, and a 7-day outlook while keeping the API key on the server side.

## Features

- Detects your location using browser geolocation, with a fallback to IP-based lookup.
- Supports searching for weather by city name.
- Shows current conditions, forecast details, and usage information.
- Handles API errors gracefully with clear feedback in the UI.

## Prerequisites

- Node.js 18 or newer
- npm
- A WeatherAI API key

## Installation

1. Clone the repository and move into the project folder:

   ```bash
   git clone https://github.com/mdadnanshuvo/weather-ai.git
   cd weather-ai
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Create your environment file:

   - On macOS/Linux:

     ```bash
     cp .env.example .env
     ```

   - On Windows PowerShell:

     ```powershell
     Copy-Item .env.example .env
     ```

4. Open the new .env file and add your WeatherAI API key:

   ```env
   WEATHERAI_API_KEY=your_api_key_here
   ```

5. Start the app:

   - For normal use:

     ```bash
     npm start
     ```

   - For development mode with auto-reload:

     ```bash
     npm run dev
     ```

6. Open your browser at:

   ```text
   http://localhost:3000
   ```

## Project Structure

```text
server.js          Express server and API routes
public/index.html  UI markup
public/style.css   Styling
public/app.js      Frontend logic and rendering
.env.example       Example environment file
```

## Notes

- The API key is never exposed to the browser.
- The app uses a small in-memory cache to reduce repeated requests for the same location.
