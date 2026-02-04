# Coursera MCP Server for Poke

An MCP (Model Context Protocol) server that allows Poke AI to access your Coursera course data including enrollments, lectures, assignments, and progress.

## Features

- List enrolled courses and specializations
- Get course materials (modules, lessons, videos)
- Read lecture transcripts and content
- View assignments and quizzes
- Track progress and grades
- Search for courses
- Get upcoming deadlines

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get Your Coursera Cookies

You need to extract authentication cookies from your browser:

1. Open [Coursera](https://www.coursera.org) in your browser and log in
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to **Application** tab → **Cookies** → `https://www.coursera.org`
4. Find the `CAUTH` cookie and copy its value

### 3. Configure Environment

Create a `.env.local` file in the project root:

```env
# Required: Your Coursera CAUTH cookie
COURSERA_CAUTH=your_cauth_cookie_value_here

# OR copy all cookies (alternative method)
# COURSERA_COOKIES=CAUTH=xxx; csrf3-token=yyy; ...

# Optional: Server configuration
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3334
MCP_API_KEY=your_optional_api_key
```

### 4. Run the Server

```bash
npm run start:http
```

You should see:
```
========================================
Coursera MCP Server
========================================
Listening on: http://127.0.0.1:3334
MCP endpoint: http://127.0.0.1:3334/mcp
========================================
```

### 5. Connect to Poke

1. Open Poke
2. Go to **Connections** → **Add Integration** → **Create**
3. Set:
   - **Name**: Coursera
   - **Server URL**: `http://localhost:3334/mcp`
   - **API Key**: (leave empty unless you set MCP_API_KEY)
4. Click **Save**

## Available Tools

| Tool | Description |
|------|-------------|
| `list_enrollments` | List all courses you're enrolled in |
| `get_course` | Get details for a specific course |
| `list_course_materials` | List modules and materials in a course |
| `get_lecture` | Get lecture details and transcript |
| `get_reading` | Get reading material content |
| `list_assignments` | List assignments/quizzes in a course |
| `get_assignment` | Get assignment details and questions |
| `get_progress` | Get your progress in a course |
| `search_courses` | Search for courses on Coursera |
| `list_specializations` | List enrolled specializations |
| `get_deadlines` | Get upcoming deadlines |

## Example Usage in Poke

Once connected, you can ask Poke things like:

- "What courses am I enrolled in on Coursera?"
- "Show me the materials for my machine learning course"
- "What assignments do I have due this week?"
- "Get the transcript from the latest lecture in my Python course"
- "What's my progress in the data science specialization?"

## Troubleshooting

### "Missing COURSERA_COOKIES or COURSERA_CAUTH env var"

Make sure you've created `.env.local` with your CAUTH cookie value.

### "Coursera API error 401"

Your session has expired. Get a fresh CAUTH cookie from your browser.

### "Coursera API error 403"

Some courses may have restricted API access. Try a different course.

### Connection Issues

- Make sure the server is running (`npm run start:http`)
- Check that the port (3334) isn't in use by another application
- Try accessing `http://localhost:3334/health` in your browser

## Using with ngrok (Remote Access)

If you need to access the server remotely:

```bash
ngrok http 3334
```

Then use the ngrok URL (e.g., `https://abc123.ngrok.io/mcp`) as the Server URL in Poke.

## Cookie Expiration

Coursera cookies typically expire after a few weeks. If requests start failing, get fresh cookies from your browser.

## License

MIT
