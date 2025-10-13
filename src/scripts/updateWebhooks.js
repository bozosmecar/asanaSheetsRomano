require("dotenv").config();
const axios = require("axios");

async function deleteAllWebhooks() {
  const personalAccessToken = process.env.ASANA_ACCESS_TOKEN;
  const workspaceId = process.env.ASANA_WORKSPACE_ID;

  try {
    // Get all webhooks
    const response = await axios.get("https://app.asana.com/api/1.0/webhooks", {
      headers: {
        Authorization: `Bearer ${personalAccessToken}`,
      },
      params: {
        workspace: workspaceId,
        opt_fields: "gid",
      },
    });

    const webhooks = response.data.data || [];
    console.log(`Found ${webhooks.length} webhooks to delete`);

    // Delete each webhook
    for (const webhook of webhooks) {
      try {
        await axios.delete(
          `https://app.asana.com/api/1.0/webhooks/${webhook.gid}`,
          {
            headers: {
              Authorization: `Bearer ${personalAccessToken}`,
            },
          }
        );
        console.log(`Deleted webhook ${webhook.gid}`);
        // Add a small delay between deletions
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error deleting webhook ${webhook.gid}:`, error.message);
      }
    }

    console.log("Finished deleting webhooks");
  } catch (error) {
    console.error("Error fetching webhooks:", error.message);
  }
}

// Run the webhook creation script with the new URL
async function recreateWebhooks() {
  try {
    // First delete all existing webhooks
    await deleteAllWebhooks();

    // Wait a bit before creating new webhooks
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Now run the createWebhook script
    const createWebhook = require("./createWebhook");
    await createWebhook.setupWebhooks();
  } catch (error) {
    console.error("Error updating webhooks:", error);
  }
}

// If running directly (not imported)
if (require.main === module) {
  recreateWebhooks();
}

module.exports = {
  recreateWebhooks,
};
