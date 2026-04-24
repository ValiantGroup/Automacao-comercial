import "dotenv/config";
import Fastify, { FastifyRequest } from "fastify";
import cors from "@fastify/cors";

import { app as graphApp } from "./tools/graph";

const server = Fastify();

server.register(cors, {
  origin: true,
});

interface AskMessage {
  question: unknown;
  personality?: string;
  steps?: number;
}

type AskMessageType = FastifyRequest<{ Body: AskMessage }>;

// 🚀 Rota usando LangGraph
server.post("/ask", async (req: AskMessageType, res) => {
  const { question, personality = "analista", steps = 5 } = req.body;
  const normalizedQuestion =
    typeof question === "string" ? question.trim() : JSON.stringify(question ?? {});

  if (!normalizedQuestion) {
    return res.status(400).send({ error: "question is required" });
  }

  try {
    const result = await graphApp.invoke({
      input: normalizedQuestion,
      personality,
      steps,
    });

    
    console.log("response:", result);

    return res.send({
      answer: result,
      logs: result.logs,
    });
  } catch (err) {
    console.error("Erro:", err);

    return res.status(500).send({
      error: "Erro ao processar request",
    });
  }
});

// 🧠 Rota para visualizar o grafo (🔥 MUITO útil)
server.get("/graph", async (_, res) => {
  const mermaid = graphApp.getGraph().drawMermaid();

  return res.type("text/plain").send(mermaid);
});

const PORT = 5010;

server.listen({ port: PORT, host: "0.0.0.0" }, () => {
  console.log(`🚀 Prospector Agent rodando em http://localhost:${PORT}`);
});
