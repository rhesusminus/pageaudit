1. Test the endpoint you have. WORKING ON
   Cover a successful fetch, missing URL, invalid URL, and network failure. Learn how to replace the outgoing fetch in tests so they don’t depend on another website. Fastify’s inject() lets you exercise routes without starting a listening server. Official testing guide (https://fastify.dev/docs/latest/Guides/Testing/)

   Done when you can change the handler and immediately check whether its behavior still works.

2. Return an actual audit result.
   Connect the existing page checks to the endpoint. Start with one check, such as whether the page has a title, then expand.

   This teaches how to keep HTTP handling separate from the function that performs the audit.

3. Give each audit an ID and retrieve it.
   Store results in a temporary in-memory Map. Have POST /audits create an audit and add GET /audits/:id to retrieve it.

   This teaches resources, route parameters, creation responses, and 404 handling. Restarting the server will erase the results at this stage.

4. Save audits in a database.
   Replace the Map with database storage. Start with an audit’s ID, URL, creation time, and result.

   This teaches SQL, migrations, and persistence. Done when an audit survives a server restart.

5. Handle longer audits in the background.
   Once waiting becomes a real problem, let the POST return an ID immediately. Track pending, running, completed, and failed; retrieve progress through the GET endpoint.

   This teaches the difference between an HTTP request’s lifetime and the work it starts.

6. Prepare it for deployment.
   Learn environment configuration, graceful shutdown, access control, and limits on requests and fetched destinations before exposing it publicly.
