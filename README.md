# Node.js Backend

A simple Node.js backend server using Express.js with Asana integration.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the root directory and add your environment variables:

```bash
PORT=3000
ASANA_ACCESS_TOKEN=your_asana_access_token_here
ASANA_WORKSPACE_ID=1208583541607334
ASANA_WORKSPACE_NAME=my_workspace
```

To get your Asana access token:

1. Go to https://app.asana.com/0/developer-console
2. Click on "New access token"
3. Give it a name and create the token
4. Copy the token and paste it in your `.env` file

The workspace ID and name are already configured for your "my workspace" workspace.

5. Start the development server:

```bash
npm run dev
```

Or start the production server:

```bash
npm start
```

## Available Scripts

- `npm start`: Runs the server in production mode
- `npm run dev`: Runs the server in development mode with hot-reload
- `npm test`: Runs the test suite (not configured yet)

## API Endpoints

### Tasks

- `GET /`: Welcome message
- `GET /api/tasks/:taskId`: Get a specific Asana task by ID
- `GET /api/tasks/project/:projectId`: Get all tasks from a specific project
- `GET /api/tasks/project/:projectId/completed`: Get only completed tasks from a specific project

### Projects

- `GET /api/projects/workspace/:workspaceId`: Get all projects in a workspace (default workspace ID: 1208583541607334)

### Example Requests

```bash
# Get a specific task
curl http://localhost:3000/api/tasks/1234567890

# Get all tasks from a project
curl http://localhost:3000/api/tasks/project/1234567890

# Get only completed tasks from a project
curl http://localhost:3000/api/tasks/project/1234567890/completed

# Get all projects in your workspace
curl http://localhost:3000/api/projects/workspace/1208583541607334
```

The project tasks endpoints return tasks with their names, assignees, completion status, due dates, and notes. The completed tasks endpoint also includes the completion date. By default, each endpoint returns up to 100 tasks per request.

The workspace projects endpoint returns projects with their names, owners, due dates, current status, creation and modification dates, visibility settings, and notes.
