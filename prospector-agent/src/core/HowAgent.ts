import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { extractText } from "../utils/extractText";


export class HowAgent {
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
        `You are a ${this.getPersonality(personality)} in Business Inteligence.
        Use the attendance_report (the 'what') and the market_intelligence (the 'who') in ${question} 
        to create a strategic plan. Your goal is to design digital solutions that solve the immediate complaint while scaling the customer's business.
        Output format: add that json and return all in a json exactly that: 
        digital_improvement_strategy: {
          improvements: { --- what we can do to improve a quick solution for some problem --- }
          scaling_opportunities: { --- based on the client's market positioning, what digital solutions can we implement to help them grow? --- }
        }.
        Return the output format in brazilian portuguese`,
      ),
      new HumanMessage(question),
    ]);

    console.log("Pergunta:", question);

    return extractText(response.content);
  }
}