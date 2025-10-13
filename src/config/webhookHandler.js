const { google } = require("googleapis");
const { getGoogleSheetsClient } = require("./googleSheets");
const { tasksApi } = require("./asana");

// Cache for storing the spreadsheet data structure
let spreadsheetCache = {
  id: null,
  headers: [
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
  ],
};

function setSpreadsheetId(id) {
  spreadsheetCache.id = id;
}

function getSpreadsheetId() {
  if (!spreadsheetCache.id) {
    throw new Error(
      "Spreadsheet ID not set. Please set it before using webhook functions."
    );
  }
  return spreadsheetCache.id;
}

// Process task data in the same way as the export function
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
    assignee: task.assignee?.name || "",
    completed_at: task.completed_at || "",
    completed: task.completed,
    ...customFieldValues,
  };
}

// Find a task's row in the spreadsheet by Task ID
async function findTaskRow(sheets, taskId) {
  try {
    console.log(`\nLooking for task with ID: ${taskId} in Google Sheet...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: "Sheet1!A:S", // Include all columns up to Completed
    });

    const rows = response.data.values || [];
    console.log(`Total rows in sheet: ${rows.length}`);

    // Task ID is the second-to-last column (index 17 based on our headers)
    const taskIdColumnIndex = 17; // Hardcoding this to ensure we're looking at the right column

    console.log(
      `Looking for Task ID in column ${taskIdColumnIndex + 1} (Task ID column)`
    );
    for (let i = 1; i < rows.length; i++) {
      // Start from 1 to skip header
      if (rows[i] && rows[i][taskIdColumnIndex]) {
        //console.log(
        // `Comparing row ${i + 1}: ${rows[i][taskIdColumnIndex]} with ${taskId}`
        //);
        if (rows[i][taskIdColumnIndex] === taskId) {
          console.log(`Found task at row ${i + 1}`);
          console.log(`Current row data:`, rows[i]);
          return i + 1; // Adding 1 because spreadsheet rows are 1-indexed
        }
      }
    }
    console.log("Task not found in spreadsheet");
    return null;
  } catch (error) {
    console.error("Error finding task row:", error);
    return null;
  }
}

// Update a specific row in the spreadsheet
async function updateSpreadsheetRow(sheets, rowIndex, values) {
  try {
    console.log(`\nUpdating row ${rowIndex} in Google Sheet...`);
    console.log("New values:", values);

    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Sheet1!A${rowIndex}:S${rowIndex}`, // Update to include all columns
      valueInputOption: "RAW",
      resource: {
        values: [values],
      },
    });
    console.log("Row updated successfully");
  } catch (error) {
    console.error("Error updating spreadsheet row:", error);
    throw error;
  }
}

// Add a new row to the spreadsheet
async function addSpreadsheetRow(sheets, values) {
  try {
    console.log("\nAdding new row to Google Sheet...");
    console.log("Values:", values);

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: "Sheet1!A:S", // Update to include all columns
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [values],
      },
    });
    console.log("New row added successfully");
  } catch (error) {
    console.error("Error adding spreadsheet row:", error);
    throw error;
  }
}

// Delete a row from the spreadsheet
async function deleteSpreadsheetRow(sheets, rowIndex) {
  try {
    console.log(`\nDeleting row ${rowIndex} from Google Sheet...`);

    // First, let's verify the row we're about to delete
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `Sheet1!A${rowIndex}:S${rowIndex}`,
    });

    if (response.data.values && response.data.values[0]) {
      console.log("Row to be deleted:", response.data.values[0]);
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      resource: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: "ROWS",
                startIndex: rowIndex - 1,
                endIndex: rowIndex,
              },
            },
          },
        ],
      },
    });
    console.log("Row deleted successfully");
  } catch (error) {
    console.error("Error deleting spreadsheet row:", error);
    throw error;
  }
}

// Function to ensure webhook secrets sheet exists
async function ensureWebhookSecretsSheet(sheets, spreadsheetId) {
  try {
    if (spreadsheetId) {
      setSpreadsheetId(spreadsheetId);
    }

    // Get the spreadsheet metadata
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: getSpreadsheetId(),
    });

    // Check if webhook_secrets sheet exists
    const secretsSheet = spreadsheet.data.sheets.find(
      (sheet) => sheet.properties.title === "webhook_secrets"
    );

    if (!secretsSheet) {
      // Create the webhook_secrets sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: "webhook_secrets",
                  hidden: true, // Hide the sheet from normal view
                },
              },
            },
          ],
        },
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: "webhook_secrets!A1:B1",
        valueInputOption: "RAW",
        resource: {
          values: [["webhook_id", "secret"]],
        },
      });
    }
  } catch (error) {
    console.error("Error ensuring webhook secrets sheet:", error);
    throw error;
  }
}

// Function to store webhook secret
async function storeWebhookSecret(sheets, webhookId, secret, spreadsheetId) {
  try {
    if (spreadsheetId) {
      setSpreadsheetId(spreadsheetId);
    }

    console.log("\n=== Storing Webhook Secret ===");
    console.log("Webhook ID:", webhookId);
    console.log("Secret:", secret);

    try {
      await ensureWebhookSecretsSheet(sheets, spreadsheetId);
    } catch (error) {
      console.error(
        "Error ensuring webhook_secrets sheet exists:",
        error.message
      );
      if (error.code === 429) {
        console.log(
          "Rate limited when creating webhook_secrets sheet. Waiting and retrying..."
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await ensureWebhookSecretsSheet(sheets, spreadsheetId);
      } else {
        throw error;
      }
    }

    // First check if this webhook ID already exists - with retry
    let rows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: getSpreadsheetId(),
        range: "webhook_secrets!A:B",
      });
      rows = response.data.values || [];
      console.log("Current rows in webhook_secrets sheet:", rows);
    } catch (error) {
      console.error("Error fetching webhook secrets:", error.message);
      if (error.code === 429) {
        console.log(
          "Rate limited when fetching webhook secrets. Waiting and retrying..."
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: getSpreadsheetId(),
          range: "webhook_secrets!A:B",
        });
        rows = response.data.values || [];
      } else {
        throw error;
      }
    }

    // Instead of clearing the sheet, we'll just append or update
    // This reduces the number of API calls
    const existingSecrets = rows.slice(1); // Skip header
    const existingIndex = existingSecrets.findIndex(
      (row) => row[0] === webhookId
    );

    if (existingIndex !== -1) {
      // Update existing secret
      console.log(`Updating existing webhook secret for ${webhookId}`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `webhook_secrets!A${existingIndex + 2}:B${existingIndex + 2}`, // +2 for header and 1-indexed
        valueInputOption: "RAW",
        resource: {
          values: [[webhookId, secret]],
        },
      });
    } else {
      // Add new secret
      console.log(`Adding new webhook secret for ${webhookId}`);
      await sheets.spreadsheets.values.append({
        spreadsheetId: getSpreadsheetId(),
        range: "webhook_secrets!A:B",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        resource: {
          values: [[webhookId, secret]],
        },
      });
    }

    console.log(`Webhook secret for ${webhookId} stored successfully`);
  } catch (error) {
    console.error("Error storing webhook secret:", error);
    throw error;
  }
}

// Function to get all webhook secrets
async function getWebhookSecrets(sheets, spreadsheetId) {
  try {
    if (spreadsheetId) {
      setSpreadsheetId(spreadsheetId);
    }

    try {
      await ensureWebhookSecretsSheet(sheets, spreadsheetId);
    } catch (error) {
      console.error(
        "Error ensuring webhook_secrets sheet exists:",
        error.message
      );
      if (error.code === 429) {
        console.log(
          "Rate limited when creating webhook_secrets sheet. Waiting and retrying..."
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await ensureWebhookSecretsSheet(sheets, spreadsheetId);
      } else {
        throw error;
      }
    }

    // Get webhook secrets with retry logic
    let response;
    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: getSpreadsheetId(),
        range: "webhook_secrets!A2:B",
      });
    } catch (error) {
      console.error("Error fetching webhook secrets:", error.message);
      if (error.code === 429) {
        console.log(
          "Rate limited when fetching webhook secrets. Waiting and retrying..."
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        response = await sheets.spreadsheets.values.get({
          spreadsheetId: getSpreadsheetId(),
          range: "webhook_secrets!A2:B",
        });
      } else {
        throw error;
      }
    }

    const secrets = new Map();
    if (response.data.values) {
      response.data.values.forEach(([webhookId, secret]) => {
        if (secret) {
          // Only add valid secrets
          secrets.set(secret, true);
        }
      });
    }

    console.log(`Retrieved ${secrets.size} webhook secrets`);
    return secrets;
  } catch (error) {
    console.error("Error getting webhook secrets:", error);
    return new Map(); // Return empty map on error to prevent complete failure
  }
}

// Handle webhook events
async function handleWebhookEvent(event, spreadsheetId) {
  try {
    console.log("\n=== Webhook Event Received ===");
    console.log("Event Type:", event.action);
    console.log("Resource Type:", event.resource.resource_type);
    console.log("Resource GID:", event.resource.gid);

    const sheets = await getGoogleSheetsClient();
    setSpreadsheetId(spreadsheetId);

    // Get task details
    const taskGid = event.resource.gid;

    switch (event.action) {
      case "changed":
      case "added": {
        const opts = {
          opt_fields:
            "gid,name,assignee.name,assignee.gid,completed,completed_at,custom_fields,memberships.project.name,memberships.project.gid",
        };

        console.log("\nFetching task details...");
        const task = await tasksApi.getTask(taskGid, opts);
        const taskData = task.data;

        const projectName = taskData.memberships[0]?.project?.name || "";
        const projectId = taskData.memberships[0]?.project?.gid || "";
        const isAssignedToManager = taskData.assignee?.name === "Manager";
        const isAssignedToWithdrawals =
          taskData.assignee?.name === "Withdrawals";
        const isAssignedToWithdraws = taskData.assignee?.name === "Withdraws";

        console.log("Project:", projectName);
        console.log("Project ID:", projectId);
        console.log("Task:", taskData.name);
        console.log("Task ID:", taskData.gid);
        console.log("Assignee:", taskData.assignee?.name || "Unassigned");
        console.log("Completed:", taskData.completed ? "Yes" : "No");
        console.log("Assigned to Manager:", isAssignedToManager ? "Yes" : "No");
        console.log(
          "Assigned to Withdrawals:",
          isAssignedToWithdrawals ? "Yes" : "No"
        );
        console.log(
          "Assigned to Withdraws:",
          isAssignedToWithdraws ? "Yes" : "No"
        );

        // Get workspace ID from project memberships
        const workspaceId = taskData.memberships[0]?.project?.workspace?.gid;
        const processedTask = processTaskData(taskData, workspaceId);

        // Create row values array
        const rowValues = [
          projectName,
          processedTask.task_name,
          processedTask.assignee || "",
          processedTask.completed_at,
          processedTask["Worker"] || "",
          processedTask["Status"] || "",
          processedTask["Paid with..."] || "",
          processedTask["Deposit"] || "",
          processedTask["Bonus"] || "",
          processedTask["Max bet"] || "",
          processedTask["WG"] || "",
          processedTask["Max win"] || "",
          processedTask["Balance"] || "",
          processedTask["Groups"] || "",
          processedTask["Received"] || "",
          processedTask["RM/BM"] || "",
          projectId,
          taskData.gid,
          taskData.completed ? "Yes" : "No",
        ];

        // Add lowercase balance for specific workspace
        if (workspaceId === "1205846480740952") {
          rowValues.push(processedTask["balance"] || "");
        }

        // Check if task already exists in spreadsheet
        const existingRowIndex = await findTaskRow(sheets, taskData.gid);

        if (existingRowIndex) {
          // Update if task exists
          console.log(
            `Updating existing task. Assignee: ${
              processedTask.assignee || "Unassigned"
            }, Completed status: ${taskData.completed ? "Yes" : "No"}`
          );
          await updateSpreadsheetRow(sheets, existingRowIndex, rowValues);
        } else if (
          taskData.completed ||
          isAssignedToManager ||
          isAssignedToWithdrawals ||
          isAssignedToWithdraws
        ) {
          // Add new row if task is completed OR assigned to Manager/Withdrawals/Withdraws
          console.log(
            taskData.completed
              ? "Adding new completed task to sheet"
              : `Adding new task assigned to ${taskData.assignee.name} to sheet`
          );
          await addSpreadsheetRow(sheets, rowValues);
        } else {
          console.log(
            "Task is not completed and not assigned to Manager/Withdrawals/Withdraws - skipping"
          );
        }
        break;
      }

      case "removed":
      case "deleted": {
        console.log(`\nHandling task deletion for task ID: ${taskGid}`);
        const rowIndex = await findTaskRow(sheets, taskGid);
        if (rowIndex) {
          console.log(`Found task to delete at row ${rowIndex}`);
          await deleteSpreadsheetRow(sheets, rowIndex);
          console.log(`Deleted row ${rowIndex} from spreadsheet`);
        } else {
          console.log("Task not found in spreadsheet, no deletion needed");
        }
        break;
      }
    }
  } catch (error) {
    console.error("Error handling webhook event:", error);
    throw error;
  }
}

module.exports = {
  handleWebhookEvent,
  storeWebhookSecret,
  getWebhookSecrets,
  ensureWebhookSecretsSheet,
  setSpreadsheetId,
};
