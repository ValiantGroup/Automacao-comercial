import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { KnowAgent } from "../core/KnowAgent";
import { HowAgent } from "../core/HowAgent";
import { RAAgent } from "../core/RAAgent";

const raaAgent = new RAAgent();
const knowAgent = new KnowAgent();
const howAgent = new HowAgent();

const AgentState = Annotation.Root({
  input: Annotation<string>(),
  personality: Annotation<string>(),
  steps: Annotation<number>(),

  ra_output: Annotation<string | undefined>(),
  know_output: Annotation<string | undefined>(),
  how_output: Annotation<string | undefined>(),

  logs: Annotation<string[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),
});

type State = typeof AgentState.State;

const graph = new StateGraph(AgentState);

const RAANode = async (state: State) => {
  const startTime = Date.now();

  try {
    const result = await raaAgent.ask(
      state.input,
      state.personality,
    );

    return {
      ra_output: result,
      logs: [
        `🧠 RAAgent executado`,
        `📤 output: ${result.slice(0, 80)}...`,
        `✅ ${Date.now() - startTime}ms`,
      ],
    };
  } catch (error: any) {
    return {
      logs: [`❌ RAAgent: ${error.message}`],
    };
  }
};

const KnowNode = async (state: State) => {
  const startTime = Date.now();

  try {
    const input = state.ra_output ?? state.input;

    const result = await knowAgent.ask(
      input,
      state.personality,
    );

    return {
      know_output: result,
      logs: [
        `🧠 KnowAgent executado`,
        `📥 input: ${input.slice(0, 80)}...`,
        `📤 output: ${result.slice(0, 80)}...`,
        `✅ ${Date.now() - startTime}ms`,
      ],
    };
  } catch (error: any) {
    return {
      logs: [`❌ KnowAgent: ${error.message}`],
    };
  }
};

const HowNode = async (state: State) => {
  const startTime = Date.now();

  try {
    const input = state.know_output ?? state.input;

    const result = await howAgent.ask(
      input,
      state.personality,
    );

    return {
      how_output: result,
      logs: [
        `⚙️ HowAgent executado`,
        `📥 input: ${input.slice(0, 80)}...`,
        `📤 output: ${result.slice(0, 80)}...`,
        `✅ ${Date.now() - startTime}ms`,
      ],
    };
  } catch (error: any) {
    return {
      logs: [`❌ HowAgent: ${error.message}`],
    };
  }
};


graph
  .addNode("RAAgent", RAANode)
  .addNode("KnowAgent", KnowNode)
  .addNode("HowAgent", HowNode)

  .addEdge(START, "RAAgent")
  .addEdge("RAAgent", "KnowAgent")
  .addEdge("KnowAgent", "HowAgent")
  .addEdge("HowAgent", END);

export const app = graph.compile();
