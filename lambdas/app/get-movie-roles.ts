import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Log the username and request path
  logRequest(event);


// Check the movie ID from the URL
  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }
  try {
    // Check the optional actor filter
    const actorParam = event.queryStringParameters?.actor;
    const actorId = parseId(actorParam);

    if (actorParam !== undefined && actorId === undefined) {
      return response(400, { message: "actor must be a positive integer" });
    }


    // Find all roles for this movie
    const commandInput: QueryCommandInput = {
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": movieKey(movieId),
        ":prefix": "a#",
      },
    };


    // If an actor was supplied, find only that actor's role
    if (actorId !== undefined) {
      commandInput.KeyConditionExpression = "PK = :pk AND SK = :sk";
      commandInput.ExpressionAttributeValues = {
        ":pk": movieKey(movieId),
        ":sk": actorKey(actorId),
      };
    }

    const queryResult = await ddb.send(new QueryCommand(commandInput));

    const resultItems = queryResult.Items ?? [];
    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    // Log unexpected errors and return a general message
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};