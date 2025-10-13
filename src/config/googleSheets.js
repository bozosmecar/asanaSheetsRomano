const { google } = require("googleapis");

// Function to initialize Google Sheets client
async function getGoogleSheetsClient() {
  try {
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    } catch (parseError) {
      console.error("Error parsing Google Sheets credentials:", parseError);
      throw new Error(
        "Invalid Google Sheets credentials format. Please check your .env file."
      );
    }

    if (!credentials.client_email || !credentials.private_key) {
      throw new Error(
        "Missing required credentials (client_email or private_key)"
      );
    }

    const client = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });

    // Test the authentication
    await client.authorize();

    return google.sheets({ version: "v4", auth: client });
  } catch (error) {
    console.error("Error initializing Google Sheets client:", error);
    throw error;
  }
}

module.exports = {
  getGoogleSheetsClient,
};
