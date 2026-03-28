Feature: FIX Message Ingestion
  As a trade system client
  I want to POST FIX protocol messages to the ingestion API
  So that they are durably stored in S3 and queued in SQS for processing

  Background:
    Given the ingestion API endpoint is available

  Scenario Outline: Ingest a valid FIX message
    Given the fixture file "<fixture>"
    When I POST the FIX input to the ingestion API
    Then the response status code should be <statusCode>
    And the response body should contain message "<message>"
    And the response body should contain an s3Key matching "<s3KeyPattern>"
    And the FIX message should be durably stored in the audit trail
    And the response should be durably stored in the audit trail

    Examples:
      | fixture                          | statusCode | message  | s3KeyPattern     |
      | new-order-buy-market             | 200        | received | ^raw/.*\\.fix$   |
      | new-order-sell-limit             | 200        | received | ^raw/.*\\.fix$   |
      | order-cancel-request             | 200        | received | ^raw/.*\\.fix$   |
      | execution-report-partial-fill    | 200        | received | ^raw/.*\\.fix$   |
      | missing-fix-body                 | 200        | received | ^raw/.*\\.fix$   |
