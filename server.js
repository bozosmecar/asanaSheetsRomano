require("dotenv").config();
const express = require("express");
const cors = require("cors");
// Ensure a fetch implementation is available for google libraries that require it
try {
  if (typeof globalThis.fetch === "undefined") {
    // node-fetch v2 uses CommonJS; require it and assign to globalThis.fetch
    // This will throw if node-fetch isn't installed, but that's fine — it will
    // cause a clearer error during deploy. When installed, this ensures the
    // module is bundled and available at runtime.
    // eslint-disable-next-line global-require
    globalThis.fetch = require("node-fetch");
    console.log("FETCH SHIM: node-fetch loaded and assigned to globalThis.fetch");
  }
} catch (e) {
  console.warn("FETCH SHIM: unable to load node-fetch:", e && e.message);
}

const crypto = require("node:crypto");
const taskRoutes = require("./src/routes/taskRoutes");
const projectRoutes = require("./src/routes/projectRoutes");
const {
  handleWebhookEvent,
  storeWebhookSecret,
  getWebhookSecrets,
} = require("./src/config/webhookHandler");
const { getGoogleSheetsClient } = require("./src/config/googleSheets");

const app = express();
const port = process.env.PORT || 3000;

// Startup environment quick-checks (safe, no secrets logged)
try {
  console.log('ENV CHECK: ASANA_ACCESS_TOKEN present:', !!process.env.ASANA_ACCESS_TOKEN);
  console.log('ENV CHECK: ASANA_WORKSPACE_ID present:', !!process.env.ASANA_WORKSPACE_ID);
  console.log('ENV CHECK: GOOGLE_DRIVE_FOLDER_ID present:', !!process.env.GOOGLE_DRIVE_FOLDER_ID);
  console.log('ENV CHECK: ASANA_WEBHOOK_TARGET present:', !!process.env.ASANA_WEBHOOK_TARGET);

  // Try to parse GOOGLE_SHEETS_CREDENTIALS safely to catch JSON issues early
  if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    try {
      JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
      console.log('ENV CHECK: GOOGLE_SHEETS_CREDENTIALS JSON: OK');
    } catch (e) {
      console.error('ENV CHECK ERROR: GOOGLE_SHEETS_CREDENTIALS JSON parse failed:', e.message);
    }
  } else {
    console.log('ENV CHECK: GOOGLE_SHEETS_CREDENTIALS present: false');
  }
} catch (err) {
  console.error('ENV CHECK unexpected error:', err && err.message);
}

// Rate limiter for Google Sheets API
// Helps prevent 429 "Quota exceeded" errors
const sheetsRateLimiter = {
  queue: [],
  processing: false,
  requestsPerMinute: 60, // Conservative limit
  minDelayMs: 1000, // Minimum 1s between requests

  // Add an operation to the queue
  enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.processQueue();
    });
  },

  // Process the next operation in the queue
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const { operation, resolve, reject } = this.queue.shift();

    try {
      console.log(
        `Processing Google Sheets API request. Queue length: ${this.queue.length}`
      );
      const result = await operation();
      resolve(result);
    } catch (error) {
      console.error("Error in Google Sheets operation:", error.message);

      // If rate limited, add back to queue with exponential backoff
      if (error.code === 429) {
        console.log("Google Sheets API rate limited. Retrying with backoff...");
        // Wait longer and retry
        setTimeout(() => {
          this.queue.unshift({ operation, resolve, reject });
        }, 5000 + Math.random() * 5000); // 5-10s backoff
      } else {
        reject(error);
      }
    } finally {
      // Wait before processing next request
      setTimeout(() => {
        this.processing = false;
        this.processQueue();
      }, this.minDelayMs);
    }
  },
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Node.js Backend API" });
});

// Webhook endpoint
app.post("/receiveWebhook", async (req, res) => {
  try {
    // Get the spreadsheet ID from the query parameter
    const spreadsheetId = req.query.sheetId;
    if (!spreadsheetId) {
      console.error("No spreadsheet ID provided in webhook URL");
      return res.sendStatus(400);
    }

    const sheets = await getGoogleSheetsClient();

    if (req.headers["x-hook-secret"]) {
      // This is a new webhook handshake
      console.log("Receiving new webhook handshake");
      const hookSecret = req.headers["x-hook-secret"];
      const webhookId = req.body.data?.id;

      // Store the secret in Google Sheets with rate limiting
      try {
        await sheetsRateLimiter.enqueue(async () => {
          return await storeWebhookSecret(
            sheets,
            webhookId,
            hookSecret,
            spreadsheetId
          );
        });

        // Echo back the secret
        res.setHeader("X-Hook-Secret", hookSecret);
        res.sendStatus(200);
        console.log("Webhook handshake completed successfully");
      } catch (error) {
        console.error("Failed to store webhook secret:", error);
        res.status(500).send("Failed to store webhook secret");
      }
    } else if (req.headers["x-hook-signature"]) {
      // This is a webhook event
      const signature = req.headers["x-hook-signature"];
      const body = JSON.stringify(req.body);

      // Get all webhook secrets from Google Sheets with rate limiting
      let webhookSecrets;
      try {
        webhookSecrets = await sheetsRateLimiter.enqueue(async () => {
          return await getWebhookSecrets(sheets, spreadsheetId);
        });
      } catch (error) {
        console.error("Failed to get webhook secrets:", error);
        return res.status(500).send("Failed to verify webhook signature");
      }
// Verify the signature against all stored secrets
      let isValid = false;

      // Try all stored secrets
      for (const [secret] of webhookSecrets) {
        const computedSignature = crypto
          .createHmac("SHA256", secret)
          .update(body)
          .digest("hex");

        if (computedSignature === signature) {
          isValid = true;
          break;
        }
      }

      if (!isValid) {
        console.log("Invalid webhook signature");
        return res.sendStatus(401);
      }

      // Valid signature - send 200 response immediately
      res.sendStatus(200);

      console.log(`Processing webhook events at ${new Date().toISOString()}`);

      // Process events asynchronously (don't block response)
      if (req.body.events && Array.isArray(req.body.events)) {
        // Process one event at a time to avoid rate limits
        const processEvents = async () => {
          for (const event of req.body.events) {
            try {
              console.log("Processing event:", event);
              await sheetsRateLimiter.enqueue(async () => {
                return await handleWebhookEvent(event, spreadsheetId);
              });
            } catch (error) {
              console.error("Error processing event:", error);
              // Continue with other events even if one fails
            }
          }
        };

        // Start processing events without blocking response
        processEvents().catch((err) => {
          console.error("Failed to process events:", err);
        });
      }
    } else {
      console.error("Invalid webhook request - missing required headers");
      res.sendStatus(400);
    }
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.sendStatus(500);
  }
});

// Task routes
app.use("/api/tasks", taskRoutes);

// Project routes
app.use("/api/projects", projectRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: "The requested resource was not found",
  });
});

// Start server
module.exports = app; // ✅ required by Vercel

