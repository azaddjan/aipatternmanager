#!/usr/bin/env python3
"""Populate technology descriptions, doc URLs, and websites."""
import requests

API = "http://localhost:8000/api"

TECH_DATA = {
    "aws-api-gateway": {
        "description": "Fully managed API management service for creating, publishing, and securing REST, HTTP, and WebSocket APIs at any scale.",
        "doc_url": "https://docs.aws.amazon.com/apigateway/",
        "website": "https://aws.amazon.com/api-gateway/",
        "cost_tier": "LOW",
    },
    "aws-aurora-pg": {
        "description": "MySQL and PostgreSQL-compatible relational database with up to 5x throughput improvement. Used with pgvector extension for vector similarity search in RAG pipelines.",
        "doc_url": "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/",
        "website": "https://aws.amazon.com/rds/aurora/",
        "cost_tier": "MEDIUM",
    },
    "aws-bedrock": {
        "description": "Fully managed service providing access to leading foundation models (Claude, Titan, Llama, Mistral) via a single API. Primary LLM provider for the platform.",
        "doc_url": "https://docs.aws.amazon.com/bedrock/",
        "website": "https://aws.amazon.com/bedrock/",
        "cost_tier": "MEDIUM",
    },
    "aws-cloudtrail": {
        "description": "Governance, compliance, and audit service that logs and monitors AWS account activity across the infrastructure. Essential for security and compliance tracking.",
        "doc_url": "https://docs.aws.amazon.com/cloudtrail/",
        "website": "https://aws.amazon.com/cloudtrail/",
        "cost_tier": "LOW",
    },
    "aws-ec2": {
        "description": "Scalable virtual compute instances in the cloud. Used for GPU workloads (p4d, p5, g5, g6 instances) hosting self-hosted LLMs and ML models.",
        "doc_url": "https://docs.aws.amazon.com/ec2/",
        "website": "https://aws.amazon.com/ec2/",
        "cost_tier": "HIGH",
    },
    "aws-eks": {
        "description": "Managed Kubernetes service for running containerized applications. Primary compute platform for self-hosted agents, RAG services, LLM gateways, and custom MCP servers.",
        "doc_url": "https://docs.aws.amazon.com/eks/",
        "website": "https://aws.amazon.com/eks/",
        "cost_tier": "MEDIUM",
    },
    "aws-eventbridge": {
        "description": "Serverless event bus for building event-driven architectures. Connects applications using events from AWS services, SaaS, and custom sources.",
        "doc_url": "https://docs.aws.amazon.com/eventbridge/",
        "website": "https://aws.amazon.com/eventbridge/",
        "cost_tier": "LOW",
    },
    "aws-kendra": {
        "description": "Enterprise search service powered by ML with 40+ native connectors for SharePoint, Salesforce, ServiceNow, S3, and more. Provides semantic search with access control inheritance.",
        "doc_url": "https://docs.aws.amazon.com/kendra/",
        "website": "https://aws.amazon.com/kendra/",
        "cost_tier": "HIGH",
    },
    "aws-lambda": {
        "description": "Serverless compute service that runs code in response to events. Used for event-driven prompt execution, tool integration, and lightweight API endpoints.",
        "doc_url": "https://docs.aws.amazon.com/lambda/",
        "website": "https://aws.amazon.com/lambda/",
        "cost_tier": "LOW",
    },
    "aws-opensearch": {
        "description": "Managed search and analytics service based on OpenSearch. Used as vector store with k-NN plugin for semantic search in RAG pipelines.",
        "doc_url": "https://docs.aws.amazon.com/opensearch-service/",
        "website": "https://aws.amazon.com/opensearch-service/",
        "cost_tier": "MEDIUM",
    },
    "aws-s3": {
        "description": "Object storage service offering scalability, durability, and security. Used for document storage, model artifacts, prompt templates, and data ingestion pipelines.",
        "doc_url": "https://docs.aws.amazon.com/s3/",
        "website": "https://aws.amazon.com/s3/",
        "cost_tier": "LOW",
    },
    "aws-sqs": {
        "description": "Fully managed message queuing service for decoupling and scaling distributed systems. Used for asynchronous task processing and event-driven workflows.",
        "doc_url": "https://docs.aws.amazon.com/sqs/",
        "website": "https://aws.amazon.com/sqs/",
        "cost_tier": "LOW",
    },
    "aws-step-functions": {
        "description": "Serverless orchestration service for building visual workflows. Used for multi-step agent orchestration, data processing pipelines, and complex automation flows.",
        "doc_url": "https://docs.aws.amazon.com/step-functions/",
        "website": "https://aws.amazon.com/step-functions/",
        "cost_tier": "LOW",
    },
    "azure-openai": {
        "description": "Microsoft Azure hosted OpenAI models (GPT-4, GPT-4o) with enterprise security, data residency, and compliance. Secondary LLM provider accessed via LLM Gateway.",
        "doc_url": "https://learn.microsoft.com/en-us/azure/ai-services/openai/",
        "website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
        "cost_tier": "MEDIUM",
    },
    "crewai": {
        "description": "Open-source multi-agent orchestration framework. Enables building teams of AI agents with role-based collaboration, task delegation, and sequential/parallel execution.",
        "doc_url": "https://docs.crewai.com/",
        "website": "https://www.crewai.com/",
        "cost_tier": "FREE",
    },
    "dynamodb": {
        "description": "Fully managed NoSQL database with single-digit millisecond performance. Used for agent session memory, conversation history, and high-throughput key-value storage.",
        "doc_url": "https://docs.aws.amazon.com/dynamodb/",
        "website": "https://aws.amazon.com/dynamodb/",
        "cost_tier": "LOW",
    },
    "langgraph": {
        "description": "Framework for building stateful, multi-step agent applications as graphs. Supports cycles, branching, persistence, and human-in-the-loop patterns for complex agent workflows.",
        "doc_url": "https://langchain-ai.github.io/langgraph/",
        "website": "https://www.langchain.com/langgraph",
        "cost_tier": "FREE",
    },
    "litellm": {
        "description": "Open-source LLM gateway proxy that provides a unified OpenAI-compatible API across 100+ LLM providers. Handles model routing, failover, rate limiting, and cost tracking.",
        "doc_url": "https://docs.litellm.ai/",
        "website": "https://www.litellm.ai/",
        "cost_tier": "FREE",
    },
    "ms-copilot-studio": {
        "description": "Microsoft low-code/no-code platform for building AI agents and copilots. Integrates natively with Teams, SharePoint, Power Platform, and Microsoft 365.",
        "doc_url": "https://learn.microsoft.com/en-us/microsoft-copilot-studio/",
        "website": "https://www.microsoft.com/en-us/microsoft-copilot/microsoft-copilot-studio",
        "cost_tier": "MEDIUM",
    },
    "onnx-runtime": {
        "description": "Cross-platform inference engine for ML models in ONNX format. Provides hardware-accelerated inference with optimizations for CPU, GPU, and specialized accelerators.",
        "doc_url": "https://onnxruntime.ai/docs/",
        "website": "https://onnxruntime.ai/",
        "cost_tier": "FREE",
    },
    "opentelemetry": {
        "description": "Open-source observability framework for generating, collecting, and exporting telemetry data (traces, metrics, logs). Platform standard for distributed tracing and monitoring.",
        "doc_url": "https://opentelemetry.io/docs/",
        "website": "https://opentelemetry.io/",
        "cost_tier": "FREE",
    },
    "redis": {
        "description": "In-memory data store used for caching, session management, and real-time data. Used for agent memory, conversation caching, and low-latency vector search.",
        "doc_url": "https://redis.io/docs/",
        "website": "https://redis.io/",
        "cost_tier": "LOW",
    },
    "salesforce-agentforce": {
        "description": "Salesforce managed AI agent platform for CRM-native agents. Pre-built agents for Sales, Service, and Marketing with Einstein Trust Layer and Data Cloud integration.",
        "doc_url": "https://developer.salesforce.com/docs/einstein/genai/guide/agentforce.html",
        "website": "https://www.salesforce.com/agentforce/",
        "cost_tier": "HIGH",
    },
    "tgi": {
        "description": "Hugging Face Text Generation Inference server for deploying and serving LLMs. Optimized for high-throughput inference with tensor parallelism, continuous batching, and quantization.",
        "doc_url": "https://huggingface.co/docs/text-generation-inference/",
        "website": "https://huggingface.co/docs/text-generation-inference/",
        "cost_tier": "FREE",
    },
    "vllm": {
        "description": "High-throughput LLM serving engine with PagedAttention for efficient memory management. Supports OpenAI-compatible API, continuous batching, and multi-GPU serving.",
        "doc_url": "https://docs.vllm.ai/",
        "website": "https://vllm.ai/",
        "cost_tier": "FREE",
    },
}


def main():
    print(f"Updating {len(TECH_DATA)} technologies...")
    for tech_id, data in TECH_DATA.items():
        res = requests.put(
            f"{API}/technologies/{tech_id}",
            json=data,
            headers={"Content-Type": "application/json"},
        )
        if res.ok:
            print(f"  Updated {tech_id}")
        else:
            print(f"  FAILED {tech_id}: {res.status_code} {res.text}")

    print("Done!")


if __name__ == "__main__":
    main()
