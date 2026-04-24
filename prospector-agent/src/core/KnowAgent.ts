import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { extractText } from "../utils/extractText";


export class KnowAgent {
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
    question: string,
    personality: string,
  ): Promise<string> {
    const response = await this.agent.invoke([
     new SystemMessage(
        `You are a ${this.getPersonality(personality)} in B2B sells.
        Based on the attendance_report.client_identity in ${question}, research and analyze this customer's business model.
        Constraint: Do not re-analyze the complaint. Focus strictly on their market positioning and potential lifetime value.
        Output format: return a json exactly that:
        market_intelligence: {
          industry_segment: { --- what industry is the customer in? --- },
          business_size: { --- is it a small, medium, or large business? --- },
          growth_opportunities: { --- based on their market positioning, where are the biggest opportunities for growth? --- }
        }.
        Return the output format in brazilian portuguese`,
      ),
      new HumanMessage(question),
    ]);

    console.log("Pergunta:", question);

    return extractText(response.content);
  }
}