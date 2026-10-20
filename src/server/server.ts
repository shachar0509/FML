import { McpServer } from "@modelcontextprotocol/server";
import { listCourses } from "@/domain/courses/courses";
import { INSTRUCTIONS } from "./instructions";

/** Transport-agnostic: tests connect it to an in-memory transport, main.ts to stdio. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "shalav", version: "2.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "shalav_home",
    { title: "My courses", description: "Show the student's Shalav courses and what to do next." },
    async () => {
      const courses = await listCourses();
      const text = courses.length
        ? courses.map((c, i) => `${i + 1}. ${c.course.courseNumber} — ${c.course.nameHe}`).join("\n")
        : "No courses yet. Ask the student which Technion course number to add.";
      return { content: [{ type: "text", text }], structuredContent: { courses: courses.map((c) => c.course) } };
    },
  );

  const prompt = (name: string, title: string, text: string) =>
    server.registerPrompt(name, { title, description: title }, () => ({
      messages: [{ role: "user", content: { type: "text", text } }],
    }));
  prompt("shalav_my_courses", "Shalav: my courses", "Open Shalav and show my courses.");
  prompt("shalav_continue_learning", "Shalav: continue learning", "Open Shalav and continue my lesson where I stopped.");

  return server;
}
