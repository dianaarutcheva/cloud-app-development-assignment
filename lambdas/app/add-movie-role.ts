import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import Ajv from "ajv";
import schema from "../shared/model.schema.json";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";

const ajv = new Ajv();
const isValidRolePayload = ajv.compile<Role>(schema);

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

// Check the request body against the Role schema.
if (!isValidRolePayload(body)) {
  return response(400, {
    message: "Incorrect type. Must match the Role schema",
    schema,
  });
}

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

    try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: {
                PK: movieKey(role.movieId),
                SK: movieKey(role.movieId),
              },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: {
                PK: actorKey(role.actorId),
                SK: actorKey(role.actorId),
              },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
                ...role,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );

    return response(201, { message: "Role added", data: role });
   } catch (err) {
    // Check if a transaction condition failed
    if (err instanceof TransactionCanceledException) {
      const reasons = err.CancellationReasons;

      // First check: the movie must exist
      if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
        return response(404, {
          message: `Movie ${role.movieId} not found`,
        });
      }

      // Second check: the actor must exist
      if (reasons?.[1]?.Code === "ConditionalCheckFailed") {
        return response(404, {
          message: `Actor ${role.actorId} not found`,
        });
      }

      // Third check: the role must not already exist
      if (reasons?.[2]?.Code === "ConditionalCheckFailed") {
        return response(409, {
          message: "A role already exists for this actor in this movie",
        });
      }
    }

    // Log unexpected errors and return a message
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
    });
  }
};