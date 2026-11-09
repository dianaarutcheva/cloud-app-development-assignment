import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import Ajv from "ajv";
import schema from "../shared/model.schema.json";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { logRequest } from "../shared/request-logger";

const ajv = new Ajv();
const isValidRolePayload = ajv.compile<Role>(schema);

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Log the administrator request and its path
  logRequest(event);


  // Read the JSON body. Return an error if it cannot be parsed.
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

// Check that all required fields have the correct types
if (!isValidRolePayload(body)) {
  return response(400, {
    message: "Incorrect type. Must match the Role schema",
    schema,
  });
}


 // Build the role data returned to the client
  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

    try {
      // Run the checks and save together. If any check fails, nothing is saved.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
             // Check that the movie exists
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
            // Check that the actor exists
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
            // Save the role only if this movie and actor pair is new
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
    // Find which transaction condition failed
    if (err instanceof TransactionCanceledException) {
      const reasons = err.CancellationReasons;

      // First item: the movie was not found.
      if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
        return response(404, {
          message: `Movie ${role.movieId} not found`,
        });
      }

      // Second item: the actor was not found
      if (reasons?.[1]?.Code === "ConditionalCheckFailed") {
        return response(404, {
          message: `Actor ${role.actorId} not found`,
        });
      }

      // Third item: the role already exists
      if (reasons?.[2]?.Code === "ConditionalCheckFailed") {
        return response(409, {
          message: "A role already exists for this actor in this movie",
        });
      }
    }

    // Log unexpected errors and return a general message
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
    });
  }
};