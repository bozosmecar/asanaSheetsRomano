require("dotenv").config();
const axios = require("axios");

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry function with exponential backoff
async function retryOperation(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Wait longer for each retry attempt
      if (attempt > 0) {
        const backoffDelay = baseDelay * Math.pow(2, attempt);
        console.log(
          `Retry attempt ${
            attempt + 1
          }/${maxRetries}, waiting ${backoffDelay}ms...`
        );
        await delay(backoffDelay);
      }

      return await operation();
    } catch (error) {
      lastError = error;

      // For rate limit errors, use the retry-after header if available
      if (error.response?.status === 429) {
        const retryAfter =
          parseInt(error.response.headers["retry-after"] || "0") * 1000;
        const waitTime =
          retryAfter > 0 ? retryAfter : baseDelay * Math.pow(2, attempt);

        console.log(
          `Rate limited. Retrying after ${waitTime / 1000} seconds...`
        );
        await delay(waitTime);
        continue;
      }

      // For server errors, retry
      if (error.response?.status >= 500 && error.response?.status < 600) {
        console.log(`Server error (${error.response.status}). Will retry...`);
        continue;
      }

      // For other errors, only retry if we're not on the last attempt
      if (attempt < maxRetries - 1) {
        console.log(`Error: ${error.message}. Will retry...`);
        continue;
      }

      // On last attempt, throw the error
      throw error;
    }
  }

  throw lastError;
}

async function deleteWorkspaceWebhooks(workspaceId, personalAccessToken) {
  try {
    // Get all webhooks for the workspace
    const response = await retryOperation(async () => {
      return await axios.get("https://app.asana.com/api/1.0/webhooks", {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`,
        },
        params: {
          workspace: workspaceId,
          opt_fields: "gid",
        },
      });
    });

    const webhooks = response.data.data || [];
    console.log(
      `Found ${webhooks.length} webhooks to delete for workspace ${workspaceId}`
    );

    // Delete each webhook
    for (const webhook of webhooks) {
      try {
        await retryOperation(async () => {
          return await axios.delete(
            `https://app.asana.com/api/1.0/webhooks/${webhook.gid}`,
            {
              headers: {
                Authorization: `Bearer ${personalAccessToken}`,
              },
            }
          );
        });

        console.log(`Deleted webhook ${webhook.gid}`);
        // Add a small delay between deletions
        await delay(1000);
      } catch (error) {
        console.error(`Error deleting webhook ${webhook.gid}:`, error.message);
      }
    }

    console.log(`Finished deleting webhooks for workspace ${workspaceId}`);
  } catch (error) {
    console.error("Error fetching webhooks:", error.message);
  }
}

// Function to get all projects in a specific workspace
async function getWorkspaceProjects(workspaceId, personalAccessToken) {
  const url = `https://app.asana.com/api/1.0/workspaces/${workspaceId}/projects`;
  try {
    const response = await retryOperation(async () => {
      return await axios.get(url, {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`,
        },
        params: {
          opt_fields: "name,archived",
          limit: 100,
        },
      });
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

// Function to create webhook for a project
async function createWebhook(targetUri, projectId, personalAccessToken) {
  try {
    const url = "https://app.asana.com/api/1.0/webhooks";

    const response = await retryOperation(
      async () => {
        return await axios.post(
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
      },
      4,
      2000
    ); // More retries and longer delay for creation

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

// Main function to set up webhooks for a specific workspace
async function setupWorkspaceWebhooks(
  workspaceId,
  personalAccessToken,
  targetUrl
) {
  try {
    console.log(`Setting up webhooks for workspace ${workspaceId}`);

    // First delete existing webhooks
    await deleteWorkspaceWebhooks(workspaceId, personalAccessToken);

    // Wait a bit before creating new webhooks
    console.log("Waiting before creating new webhooks...");
    await delay(5000);

    // Get all projects in the workspace
    console.log("\nFetching projects from workspace...");
    const projects = await getWorkspaceProjects(
      workspaceId,
      personalAccessToken
    );

    if (projects.length === 0) {
      console.log("No active projects found in workspace");
      return;
    }

    console.log(
      `Found ${projects.length} active projects. Creating webhooks...`
    );

    let successCount = 0;
    let failureCount = 0;

    // Process projects in batches to avoid overwhelming rate limits
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      console.log(
        `Creating webhook for project "${project.name}" (${project.gid}) - ${
          i + 1
        }/${projects.length}`
      );

      const success = await createWebhook(
        targetUrl,
        project.gid,
        personalAccessToken
      );

      if (success) {
        successCount++;
      } else {
        failureCount++;
      }

      // Standard delay between webhook creations
      await delay(1000);

      // Add a longer pause every 5 webhooks to avoid rate limits
      if ((i + 1) % 5 === 0 && i < projects.length - 1) {
        console.log(
          `\n>>> Completed ${i + 1}/${
            projects.length
          } webhooks. Taking a break to avoid rate limits...`
        );
        console.log(
          `Current status: ${successCount} successes, ${failureCount} failures`
        );
        // Longer break every 5 webhooks
        await delay(10000);
      }
    }

    console.log(`\nWebhook creation complete for workspace ${workspaceId}!`);
    console.log(
      `Successfully created ${successCount} webhooks out of ${projects.length} projects (${failureCount} failures)`
    );

    if (failureCount > 0) {
      console.log(
        `\nSome webhooks failed to create. You may want to run the script again to retry.`
      );
    }
  } catch (error) {
    console.error("Error setting up webhooks:", error);
  }
}

// Command line interface
if (require.main === module) {
  const workspaceId = process.argv[2];
  const targetUrl = process.argv[3] || process.env.NGROK_URL;
  const personalAccessToken = process.argv[4] || process.env.ASANA_ACCESS_TOKEN;

  if (!workspaceId || !targetUrl || !personalAccessToken) {
    console.error(
      "Please provide: workspaceId, targetUrl (or set NGROK_URL), and personalAccessToken (or set ASANA_ACCESS_TOKEN)"
    );
    process.exit(1);
  }

  setupWorkspaceWebhooks(workspaceId, personalAccessToken, targetUrl);
}

module.exports = {
  setupWorkspaceWebhooks,
  deleteWorkspaceWebhooks,
};
