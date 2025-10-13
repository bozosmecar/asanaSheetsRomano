const Asana = require("asana");
const { getGoogleSheetsClient } = require("../config/googleSheets");
const { google } = require("googleapis");
const { ensureWebhookSecretsSheet } = require("../config/webhookHandler");

const client = Asana.ApiClient.instance;
// Disable auto-pagination to work with raw responses
client.RETURN_COLLECTION = false;
client.authentications["token"].accessToken = process.env.ASANA_ACCESS_TOKEN;

const projectsApi = new Asana.ProjectsApi();
const tasksApi = new Asana.TasksApi();

// Add this constant at the top of the file after imports
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID; // You'll add this to .env

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to handle rate limits with exponential backoff
async function fetchWithRetry(fetchFunction, maxRetries = 5, baseDelay = 2000) {
  // Implements exponential backoff + jitter and honors Retry-After header when present.
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchFunction();
    } catch (error) {
      const status = error?.status || error?.response?.status || null;

      // If it's a rate limit (429) and we have retries left, backoff and retry
      if (status === 429 && attempt < maxRetries - 1) {
        // Prefer Retry-After from response headers. Header may be in response.headers and may be a string.
        const rawRetryAfter =
          error.response?.headers?.["retry-after"] ||
          error.response?.headers?.["Retry-After"] ||
          error.response?.headers?.["Retry-after"] ||
          error.response?.headers?.["Retry-After-seconds"] ||
          "0";

        const retryAfterSeconds = parseInt(String(rawRetryAfter || "0"), 10) || 0;

        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        // Add small random jitter to avoid thundering herd
        const jitter = Math.floor(Math.random() * 1000);

        // If server provided Retry-After (in seconds), use it; otherwise use exponentialDelay + jitter
        const delayMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : exponentialDelay + jitter;

        console.warn(
          `Rate limited (429). Attempt ${attempt + 1}/${maxRetries}. Waiting ${Math.round(delayMs / 1000)}s before retrying.`
        );

        // Helpful debug info
        console.debug("Rate limit headers:", error.response?.headers || {});
        await delay(delayMs);
        continue;
      }

      // For other transient server errors (5xx) we may want to retry as well
      if (status && status >= 500 && status < 600 && attempt < maxRetries - 1) {
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 1000);
        const delayMs = exponentialDelay + jitter;
        console.warn(
          `Server error (${status}). Attempt ${attempt + 1}/${maxRetries}. Retrying after ${Math.round(delayMs / 1000)}s.`
        );
        await delay(delayMs);
        continue;
      }

      // Not a transient error we know how to retry — rethrow it
      console.error("Non-retriable error or out of retries:", error?.message || error);
      throw error;
    }
  }
}

// Helper function to get all pages with rate limit handling
async function getAllPages(fetchFunction) {
  const results = [];
  let offset = null;
  let hasMore = true;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;

  while (hasMore) {
    try {
      // Add a small delay between requests to avoid hitting rate limits
      await delay(250);

      const response = await fetchWithRetry(async () => {
        return await fetchFunction(offset);
      });

      if (response.data) {
        results.push(...response.data);
      }

      // Reset error counter on successful request
      consecutiveErrors = 0;

      // Check if there are more pages
      if (response.next_page?.offset) {
        offset = response.next_page.offset;
      } else {
        hasMore = false;
      }
    } catch (error) {
      consecutiveErrors++;
      console.error("Error in pagination:", error);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `Failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stopping pagination.`
        );
        break;
      }

      // Add a longer delay after an error
      await delay(5000);
    }
  }

  return results;
}

// Helper function to process task data
function processTaskData(task, workspaceId) {
  const customFieldValues = {};

  if (task.custom_fields) {
    task.custom_fields.forEach((field) => {
      const fieldNames = [
        "Worker",
        "Status",
        "Paid with...",
        "Deposit",
        "Bonus",
        "Max bet",
        "WG",
        "Max win",
        "Balance",
        "Groups",
        "Received",
        "RM/BM",
      ];

      // Add lowercase balance for specific workspace
      if (workspaceId === "1205846480740952") {
        fieldNames.push("balance");
      }

      if (fieldNames.includes(field.name)) {
        if (field.enum_value) {
          customFieldValues[field.name] = field.enum_value.name;
        } else if (
          field.number_value !== null &&
          field.number_value !== undefined
        ) {
          customFieldValues[field.name] = field.number_value;
        } else if (field.text_value) {
          customFieldValues[field.name] = field.text_value;
        } else {
          customFieldValues[field.name] = field.display_value;
        }
      }
    });
  }

  return {
    task_name: task.name,
    task_id: task.gid,
    assignee: task.assignee ? task.assignee.name : null,
    completed_at: task.completed_at,
    completed: task.completed,
    ...customFieldValues,
  };
}

const getWorkspaceProjects = async (req, res) => {
  try {
    // Use provided workspace ID or default from environment
    const workspaceId =
      req.params.workspaceId || process.env.ASANA_WORKSPACE_ID;
    const opts = {
      opt_fields:
        "name,owner,due_date,current_status,created_at,modified_at,public,archived,color,notes,custom_fields,custom_field_settings",
      limit: 100,
    };

    const result = await projectsApi.getProjectsForWorkspace(workspaceId, opts);
    res.json(result.data);
  } catch (error) {
    console.error(
      "Error fetching workspace projects:",
      error.response?.body || error.message
    );
    res.status(error.response?.statusCode || 500).json({
      error: error.response?.body || "Internal server error",
    });
  }
};

const getWorkspaceProjectById = async (req, res) => {
  try {
    // Use provided workspace ID or default from environment
    const workspaceId =
      req.params.workspaceId || process.env.ASANA_WORKSPACE_ID;
    const opts = {
      opt_fields:
        "name,owner,due_date,current_status,created_at,modified_at,public,archived,color,notes,custom_fields,custom_field_settings",
      limit: 100,
    };

    const result = await projectsApi.getProjectForWorkspace(
      workspaceId,
      projectId,
      opts
    );
    res.json(result.data);
  } catch (error) {
    console.error(
      "Error fetching workspace projects:",
      error.response?.body || error.message
    );
    res.status(error.response?.statusCode || 500).json({
      error: error.response?.body || "Internal server error",
    });
  }
};

const getAllProjectsWithTasks = async (req, res) => {
  try {
    const workspaceId = req.query.workspaceId || process.env.ASANA_WORKSPACE_ID;

    console.log("\nFetching projects...");
    const projects = await getAllPages(async (offset) => {
      const opts = {
        opt_fields: "name,archived",
        limit: 100,
        offset: offset,
      };
      return await projectsApi.getProjectsForWorkspace(workspaceId, opts);
    });

    // Filter out archived projects
    const activeProjects = projects.filter((project) => !project.archived);
    console.log(`\nFound ${activeProjects.length} active projects`);

    const projectsWithTasks = await Promise.all(
      activeProjects.map(async (project) => {
        try {
          const isKarlProject = project.name.includes("Karl Dolan");

          if (isKarlProject) {
            console.log(`\n=== Fetching tasks for Karl's Project ===`);
          }

          // Fetch tasks using manual pagination.
          const tasks = await getAllPages(async (offset) => {
            const opts = {
              opt_fields:
                "gid,name,assignee.name,completed,completed_at,custom_fields,memberships",
              limit: 100,
              offset: offset,
              completed_since: "2000-01-01T00:00:00.000Z",
            };
            return await tasksApi.getTasksForProject(project.gid, opts);
          });

          if (isKarlProject) {
            console.log(`\nTotal raw tasks fetched: ${tasks.length}`);
            console.log("Task names:");
            tasks.forEach((task, index) => {
              console.log(
                `${index + 1}. ${task.name} (Completed: ${task.completed})`
              );
            });
          }

          const processedTasks = tasks
            .filter((task) => task.completed)
            .map(processTaskData);

          if (isKarlProject) {
            console.log(`\nProcessed tasks count: ${processedTasks.length}`);
            console.log("=== End of Karl's Project Info ===\n");
          }

          return {
            project_name: project.name,
            project_id: project.gid,
            task_count: processedTasks.length,
            raw_task_count: tasks.length,
            tasks: processedTasks,
          };
        } catch (error) {
          console.error(
            `Error fetching tasks for project ${project.name}:`,
            error
          );
          return {
            project_name: project.name,
            project_id: project.gid,
            task_count: 0,
            tasks: [],
            error: error.message,
          };
        }
      })
    );

    // Filter out projects with no completed tasks
    const projectsWithCompletedTasks = projectsWithTasks.filter(
      (project) => project.tasks.length > 0
    );

    res.json({
      workspace_id: workspaceId,
      total_projects: projectsWithCompletedTasks.length,
      total_tasks: projectsWithCompletedTasks.reduce(
        (sum, project) => sum + project.tasks.length,
        0
      ),
      projects: projectsWithCompletedTasks.sort(
        (a, b) => b.task_count - a.task_count
      ),
    });
  } catch (error) {
    console.error(
      "Error fetching projects with tasks:",
      error.response?.body || error.message
    );
    res.status(error.response?.statusCode || 500).json({
      error: error.response?.body || "Internal server error",
    });
  }
};

const exportProjectsToSheet = async (req, res) => {
  try {
    const workspaceId = req.query.workspaceId || process.env.ASANA_WORKSPACE_ID;

    // First, get all projects with tasks using existing function logic
    const projects = await getAllPages(async (offset) => {
      const opts = {
        opt_fields: "name,archived",
        limit: 100,
        offset: offset,
      };
      return await projectsApi.getProjectsForWorkspace(workspaceId, opts);
    });

    const activeProjects = projects.filter((project) => !project.archived);

    const projectsWithTasks = await Promise.all(
      activeProjects.map(async (project) => {
        try {
          const tasks = await getAllPages(async (offset) => {
            const opts = {
              opt_fields:
                "gid,name,assignee.name,completed,completed_at,custom_fields,memberships",
              limit: 100,
              offset: offset,
              completed_since: "2000-01-01T00:00:00.000Z",
            };
            return await tasksApi.getTasksForProject(project.gid, opts);
          });

          // Process tasks that are either completed OR assigned to Manager
          const processedTasks = tasks
            .filter(
              (task) =>
                task.completed ||
                (task.assignee && task.assignee.name === "Manager")
            )
            .map(processTaskData);

          return {
            project_name: project.name,
            project_id: project.gid,
            tasks: processedTasks,
          };
        } catch (error) {
          console.error(
            `Error fetching tasks for project ${project.name}:`,
            error
          );
          return {
            project_name: project.name,
            project_id: project.gid,
            tasks: [],
          };
        }
      })
    );

    // Filter projects with tasks and sort by project name
    const sortedProjects = projectsWithTasks
      .filter((project) => project.tasks.length > 0)
      .sort((a, b) => a.project_name.localeCompare(b.project_name));

    // Prepare headers for the spreadsheet
    const headers = [
      "Project Name",
      "Task Name",
      "Assignee",
      "Completed At",
      "Worker",
      "Status",
      "Paid with...",
      "Deposit",
      "Bonus",
      "Max bet",
      "WG",
      "Max win",
      "Balance",
      "Groups",
      "Received",
      "RM/BM",
      "Project ID",
      "Task ID",
      "Completed",
    ];

    // Prepare rows for the spreadsheet
    const rows = [];
    rows.push(headers);

    sortedProjects.forEach((project) => {
      project.tasks.forEach((task) => {
        rows.push([
          project.project_name,
          task.task_name,
          task.assignee || "",
          task.completed_at || "",
          task["Worker"] || "",
          task["Status"] || "",
          task["Paid with..."] || "",
          task["Deposit"] || "",
          task["Bonus"] || "",
          task["Max bet"] || "",
          task["WG"] || "",
          task["Max win"] || "",
          task["Balance"] || "",
          task["Groups"] || "",
          task["Received"] || "",
          task["RM/BM"] || "",
          project.project_id || "",
          task.task_id || "",
          task.completed ? "Yes" : "No",
        ]);
      });
    });

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Create a new spreadsheet
    const spreadsheet = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: `Asana Projects Export ${
            new Date().toISOString().split("T")[0]
          }`,
        },
      },
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;

    // Move the file to the specified folder using Drive API
    if (GOOGLE_DRIVE_FOLDER_ID) {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS),
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      });

      const drive = google.drive({ version: "v3", auth });

      // First get the file's current parents
      const file = await drive.files.get({
        fileId: spreadsheetId,
        fields: "parents",
      });

      // Move the file to the new folder
      await drive.files.update({
        fileId: spreadsheetId,
        addParents: GOOGLE_DRIVE_FOLDER_ID,
        removeParents: file.data.parents.join(","),
        fields: "id, parents",
      });
    }

    // Update the values
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      resource: {
        values: rows,
      },
    });

    // Auto-resize columns
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: headers.length,
              },
            },
          },
        ],
      },
    });

    res.json({
      message: "Export completed successfully",
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      spreadsheetId,
    });
  } catch (error) {
    console.error("Error exporting to Google Sheets:", error);
    res.status(500).json({
      error: "Failed to export to Google Sheets",
      details: error.message,
    });
  }
};

const exportWorkspaceToSheet = async (req, res) => {
  try {
    const workspaceId = req.params.workspaceId;
    const targetSheetId = req.query.sheetId;

    if (!targetSheetId) {
      return res.status(400).json({
        error: "Missing required parameter",
        message: "Please provide a sheetId query parameter",
      });
    }

    console.log(
      `\nExporting workspace ${workspaceId} to sheet ${targetSheetId}`
    );

    // Get all projects in the workspace
    console.log("\nFetching projects...");
    const projects = await getAllPages(async (offset) => {
      const opts = {
        opt_fields: "name,archived",
        limit: 100,
        ...(offset ? { offset } : {}),
      };
      return await projectsApi.getProjectsForWorkspace(workspaceId, opts);
    });

    // Filter out archived projects
    const activeProjects = projects.filter((project) => !project.archived);
    console.log(`Found ${activeProjects.length} active projects`);

    // Prepare to store all tasks
    const allProjectTasks = [];

    // Process projects in batches to avoid rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < activeProjects.length; i += BATCH_SIZE) {
      const projectBatch = activeProjects.slice(i, i + BATCH_SIZE);
      console.log(
        `\nProcessing projects ${i + 1} to ${i + projectBatch.length} of ${
          activeProjects.length
        }`
      );

      // Process each project in the batch with a delay between projects
      for (const project of projectBatch) {
        try {
          console.log(
            `\nFetching tasks for project: ${project.name} (${project.gid})`
          );

          const tasks = await getAllPages(async (offset) => {
            const opts = {
              opt_fields:
                "name,assignee.name,completed,completed_at,custom_fields,memberships",
              limit: 100,
              completed_since: "2000-01-01",
              ...(offset ? { offset } : {}),
            };
            return await tasksApi.getTasksForProject(project.gid, opts);
          });

          // Filter and process tasks
          const relevantTasks = tasks.filter(
            (task) =>
              task.completed ||
              (task.assignee &&
                (task.assignee.name === "Manager" ||
                  task.assignee.name === "Withdrawals" ||
                  task.assignee.name === "Withdraws"))
          );

          if (relevantTasks.length > 0) {
            console.log(
              `Found ${relevantTasks.length} relevant tasks in project ${project.name}`
            );
            allProjectTasks.push({
              project_name: project.name,
              project_id: project.gid,
              tasks: relevantTasks.map((task) => ({
                task_name: task.name,
                task_id: task.gid,
                assignee: task.assignee?.name || "",
                completed_at: task.completed_at || "",
                completed: task.completed,
                ...processTaskData(task, workspaceId),
              })),
            });
          }

          // Add a delay between projects to avoid rate limits
          await delay(1000);
        } catch (error) {
          console.error(`Error processing project ${project.name}:`, error);
          // Continue with next project even if one fails
        }
      }

      // Add a longer delay between batches
      if (i + BATCH_SIZE < activeProjects.length) {
        console.log(
          "\nWaiting between project batches to avoid rate limits..."
        );
        await delay(5000);
      }
    }

    // Sort projects by name
    const sortedProjects = allProjectTasks.sort((a, b) =>
      a.project_name.localeCompare(b.project_name)
    );

    // Prepare headers for the spreadsheet
    const headers = [
      "Project Name",
      "Task Name",
      "Assignee",
      "Completed At",
      "Worker",
      "Status",
      "Paid with...",
      "Deposit",
      "Bonus",
      "Max bet",
      "WG",
      "Max win",
      "Balance",
      "Groups",
      "Received",
      "RM/BM",
      "Project ID",
      "Task ID",
      "Completed",
    ];

    // Add lowercase balance header for specific workspace
    if (workspaceId === "1205846480740952") {
      headers.push("balance");
    }

    // Prepare rows for the spreadsheet
    const rows = [];
    rows.push(headers);

    sortedProjects.forEach((project) => {
      project.tasks.forEach((task) => {
        const row = [
          project.project_name,
          task.task_name,
          task.assignee || "",
          task.completed_at || "",
          task["Worker"] || "",
          task["Status"] || "",
          task["Paid with..."] || "",
          task["Deposit"] || "",
          task["Bonus"] || "",
          task["Max bet"] || "",
          task["WG"] || "",
          task["Max win"] || "",
          task["Balance"] || "",
          task["Groups"] || "",
          task["Received"] || "",
          task["RM/BM"] || "",
          project.project_id || "",
          task.task_id || "",
          task.completed ? "Yes" : "No",
        ];

        // Add lowercase balance value for specific workspace
        if (workspaceId === "1205846480740952") {
          row.push(task["balance"] || "");
        }

        rows.push(row);
      });
    });

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Clear existing content
    await sheets.spreadsheets.values.clear({
      spreadsheetId: targetSheetId,
      range: "Sheet1!A:S",
    });

    // Update the values
    await sheets.spreadsheets.values.update({
      spreadsheetId: targetSheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      resource: {
        values: rows,
      },
    });

    // Auto-resize columns
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: targetSheetId,
      resource: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: headers.length,
              },
            },
          },
        ],
      },
    });

    // Create webhook_secrets sheet if it doesn't exist
    await ensureWebhookSecretsSheet(sheets, targetSheetId);

    res.json({
      message: "Export completed successfully",
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${targetSheetId}`,
      spreadsheetId: targetSheetId,
      workspaceId: workspaceId,
    });
  } catch (error) {
    console.error("Error exporting to Google Sheets:", error);
    res.status(500).json({
      error: "Failed to export to Google Sheets",
      details: error.message,
    });
  }
};

module.exports = {
  getWorkspaceProjects,
  getAllProjectsWithTasks,
  exportProjectsToSheet,
  exportWorkspaceToSheet,
  getWorkspaceProjectById,
};
