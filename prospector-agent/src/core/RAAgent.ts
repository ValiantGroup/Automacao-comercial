import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { extractText } from "../utils/extractText";


export class RAAgent {
  private agent: ChatOpenAI;
  private temperature: number = 0.9;

  private personality: Record<string, string> = {
    especialista: "specialist",
    analista: "analyst",
  };

  constructor() {
    this.agent = this.createModel();
  }

  private createModel() {
    return new ChatOpenAI({
      model: process.env.OPENAI_MODEL,
      apiKey: process.env.OPENAI_API_KEY,
      temperature: this.temperature,
    });
  }

  setTemperature(temp: number) {
    this.temperature = temp;
    this.agent = this.createModel(); // 🔥 recria o modelo corretamente
  }

  getPersonality(personality: string) {
    return this.personality[personality] || "analyst";
  }

  async ask(
    raw_complaint: string,
    personality: string,
  ): Promise<string> {
    const normalizedComplaint =
      typeof raw_complaint === "string"
        ? raw_complaint
        : JSON.stringify(raw_complaint ?? {});

    const response = await this.agent.invoke([
      new SystemMessage(
        `You are a ${this.getPersonality(personality)} in Client Attendance.
        Your task is to analyze the complaint: ${normalizedComplaint}. Extract the core technical issues and the client's emotional state. Compare this with the provided internal company data.
        Output format: return a json exactly that:
        attendance_report: {
            client_identity: { --- who is the customer, what they do, and their market positioning --- },
            priority_level: { --- how urgent is this complaint based on the client's emotional state and the technical issues --- },
            problem_summary: { --- a concise summary of the main problem --- },
            internal_data_match: { --- any relevant information from the company's internal data that matches the complaint --- }
        }.
        Return the output format in brazilian portuguese`,
      ),
      new HumanMessage(normalizedComplaint),
    ]);

    console.log("Pergunta:", normalizedComplaint);

    const raw = extractText(response.content);
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed?.attendance_report === "string"
        ? parsed.attendance_report
        : JSON.stringify(parsed?.attendance_report ?? parsed);
    } catch {
      return raw;
    }
  }
}
