import type { useSofa } from "sofa-api";

export const sofaOpenAPIWebhookDocs: NonNullable<
  Parameters<typeof useSofa>[0]["openAPI"]
> = {
  paths: {
    "/webhook": {
      post: {
        operationId: "webhook_create",
        description: "Creates a webhook subscription.",
        tags: [],
        parameters: [],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/WebhookCreateBody",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WebhookDetailResponse",
                },
              },
            },
          },
        },
      },
    },
    "/webhook/{id}": {
      post: {
        operationId: "webhook_update",
        description: "Updates a webhook subscription.",
        parameters: [
          {
            name: "id",
            in: "path",
            description: "The ID of the webhook to update",
            required: true,
            schema: {
              type: "string",
            },
          } as any,
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/WebhookCreateBody",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WebhookDetailResponse",
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: "webhook_delete",
        description: "Removes a webhook subscription.",
        tags: [],
        parameters: [
          {
            name: "id",
            in: "path",
            description: "The ID of the webhook to delete",
            required: true,
            schema: {
              type: "string",
            },
          } as any,
        ],
        responses: {
          "200": {
            description: "",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WebhookDetailResponse",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      WebhookCreateBody: {
        type: "object",
        properties: {
          subscription: {
            description:
              "The subscription to subscribe to. In many cases, these match the available query IDs without the '_query' suffix. E.g., 'users_query' -> 'users'. See the graphql schema for more details on what subscriptions are available.",
            type: "string",
          },
          variables: {
            description: "The variables to pass to the subscription.",
            type: "object",
          },
          url: {
            description: "The URL to send the webhook to.",
            type: "string",
          },
        },
      },
      WebhookDetailResponse: {
        type: "object",
        properties: {
          id: {
            description:
              "The ID of the webhook. Can be used as reference in update or delete calls.",
            type: "string",
          },
        },
      },
      DateTime: {
        type: "string",
        format: "date-time",
      },
      Date: {
        type: "string",
        format: "date",
      },
    },
  },
};
