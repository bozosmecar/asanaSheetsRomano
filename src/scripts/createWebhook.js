require("dotenv").config();
const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");

// File path for the .env file
const envFilePath = path.join(__dirname, "../../.env");

// Helper function to read X-Hook-Secret from the .env file
function getXHookSecret() {
  const envContent = fs.readFileSync(envFilePath, "utf8");
  const match = envContent.match(/X_HOOK_SECRET=(.*)/);
  return match ? match[1] : "";
}

// Function to get all projects in a workspace
async function getWorkspaceProjects(workspaceId, personalAccessToken) {
  const url = `https://app.asana.com/api/1.0/workspaces/${workspaceId}/projects`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${personalAccessToken}`,
      },
      params: {
        opt_fields: "name,archived",
        limit: 100,
      },
    });

    // Filter out archived projects
    return response.data.data.filter((project) => !project.archived);
  } catch (error) {
    console.error(
      "Error fetching workspace projects:",
      error.response?.data || error.message
    );
    return [];
  }
}

// Function to get all existing webhooks
async function getExistingWebhooks(personalAccessToken) {
  const url = "https://app.asana.com/api/1.0/webhooks";
  const workspaceId = process.env.ASANA_WORKSPACE_ID;
  const webhooks = [];
  let offset = null;

  try {
    do {
      const params = {
        workspace: workspaceId,
        limit: 100,
        ...(offset ? { offset } : {}),
        opt_fields: "gid,resource,target,active,filters",
      };

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`,
          Accept: "application/json",
        },
        params,
      });

      if (response.data.data) {
        webhooks.push(...response.data.data);
      }

      // Update offset for next page
      offset = response.data.next_page?.offset;
    } while (offset);

    console.log(`Successfully retrieved ${webhooks.length} webhooks`);
    return webhooks;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log("No webhooks found");
      return [];
    }
    console.error(
      "Error fetching existing webhooks:",
      error.response?.data || error.message
    );
    return [];
  }
}

// Function to find existing webhook for a project
async function findExistingWebhook(projectId, targetUri, webhooks) {
  return webhooks.find(
    (webhook) =>
      webhook.resource.gid === projectId && webhook.target === targetUri
  );
}

// Async function to delete the webhook
async function deleteWebhook(webhookId, personalAccessToken) {
  const url = `https://app.asana.com/api/1.0/webhooks/${webhookId}`;

  try {
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${personalAccessToken}`,
      },
    });
    console.log(`Webhook ${webhookId} deleted successfully.`);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      // Webhook already deleted or doesn't exist
      return true;
    }
    console.error(
      `Error deleting webhook ${webhookId}:`,
      error.response?.data || error.message
    );
    return false;
  }
}

// Async function to create the webhook
async function createWebhook(
  targetUri,
  projectId,
  personalAccessToken,
  existingWebhooks
) {
  try {
    // Check for existing webhook
    const existingWebhook = await findExistingWebhook(
      projectId,
      targetUri,
      existingWebhooks
    );
    if (existingWebhook) {
      console.log(
        `Found existing webhook ${existingWebhook.gid} for project ${projectId}. Deleting it first...`
      );
      await deleteWebhook(existingWebhook.gid, personalAccessToken);
      // Add a small delay after deletion
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const url = "https://app.asana.com/api/1.0/webhooks";
    const response = await axios.post(
      url,
      {
        data: {
          resource: projectId,
          target: targetUri,
          filters: [
            {
              action: "changed",
              resource_type: "task",
              fields: [
                "name",
                "assignee",
                "completed",
                "completed_at",
                "custom_fields",
              ],
            },
            {
              action: "removed",
              resource_type: "task",
            },
            {
              action: "deleted",
              resource_type: "task",
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`,
        },
      }
    );

    console.log(`Webhook created successfully for project ${projectId}!`);
    console.log(`The GID of the webhook is: ${response.data.data.gid}`);
    return true;
  } catch (error) {
    console.error(
      `Error creating webhook for project ${projectId}:`,
      error.response?.data || error.message
    );
    return false;
  }
}

// Main function to set up webhooks for all projects
async function setupWebhooks() {
  const ngrokUrl = process.env.NGROK_URL || process.argv[2];
  if (!ngrokUrl) {
    console.error(
      "Please provide the ngrok URL as an environment variable NGROK_URL or command line argument"
    );
    process.exit(1);
  }

  // Normalize target: if the provided URL already includes '/receiveWebhook',
  // use it as the full target (this allows passing ?sheetId=...); otherwise
  // append '/receiveWebhook' to the base URL.
  function buildTargetUrl(baseUrl) {
    if (!baseUrl) return baseUrl;
    // Trim trailing slashes
    const trimmed = baseUrl.replace(/\/+$/, "");
    if (trimmed.includes("/receiveWebhook")) {
      return trimmed; // assume user provided full path (may include query)
    }
    return `${trimmed}/receiveWebhook`;
  }

  const workspaceId = process.env.ASANA_WORKSPACE_ID;
  const personalAccessToken = process.env.ASANA_ACCESS_TOKEN;

  // First, get existing webhooks
  console.log("Fetching existing webhooks...");
  const existingWebhooks = await getExistingWebhooks(personalAccessToken);
  console.log(`Found ${existingWebhooks.length} existing webhooks.`);

  console.log("\nFetching projects from workspace...");
  const projects = await getWorkspaceProjects(workspaceId, personalAccessToken);

  if (projects.length === 0) {
    console.log("No active projects found in workspace");
    return;
  }

  console.log(`Found ${projects.length} active projects. Creating webhooks...`);

  let successCount = 0;
    for (const project of projects) {
    const targetUri = buildTargetUrl(ngrokUrl);
    console.log(
      `Creating webhook for project "${project.name}" (${project.gid})`
    );

    const success = await createWebhook(
      targetUri,
      project.gid,
      personalAccessToken,
      existingWebhooks
    );
    if (success) successCount++;

    // Add a small delay between requests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`\nWebhook creation complete!`);
  console.log(
    `Successfully created ${successCount} webhooks out of ${projects.length} projects`
  );
}

// Run the setup
setupWebhooks();
