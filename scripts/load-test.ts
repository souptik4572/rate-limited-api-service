const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const userId = process.env.USER_ID ?? 'load-test-user';
const totalRequests = Number(process.env.TOTAL_REQUESTS ?? '100');
const expectedAccepted = Number(process.env.RATE_LIMIT ?? '5');

async function main(): Promise<void> {
  const requests = Array.from({ length: totalRequests }, (_, index) =>
    fetch(`${baseUrl}/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        payload: {
          sequence: index,
        },
      }),
    }),
  );

  const responses = await Promise.all(requests);
  const counts = responses.reduce(
    (accumulator, response) => {
      if (response.status === 200) {
        accumulator.accepted += 1;
      } else if (response.status === 429) {
        accumulator.rejected += 1;
      } else {
        accumulator.unexpected += 1;
      }

      return accumulator;
    },
    { accepted: 0, rejected: 0, unexpected: 0 },
  );

  console.log(
    JSON.stringify(
      {
        baseUrl,
        userId,
        totalRequests,
        expectedAccepted,
        ...counts,
      },
      null,
      2,
    ),
  );

  if (
    counts.accepted !== expectedAccepted
    || counts.rejected !== totalRequests - expectedAccepted
    || counts.unexpected !== 0
  ) {
    process.exitCode = 1;
  }
}

void main();
