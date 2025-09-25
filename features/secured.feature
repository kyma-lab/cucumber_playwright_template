@secured
Feature: Secured Page Access

  @secured-direct
  Scenario: Direct access to secured page without login
    Given I navigate to the secured page
    Then I should see "Access Denied" message
    And I should see login button

  @secured-with-token
  Scenario: Access secured page with valid token
    Given I have a valid token for "testuser"
    When I navigate to the secured page
    Then I should see the secured content
    And I should see "TOP_SECRET_12345" in the content
    And I should see "testuser" in the user information

  @secured-navigation
  Scenario: Navigate to secured page from home page
    Given I am logged into the test app as "testuser"
    When I click "Access Secured Page" button
    Then I should see the secured content
    And I should see "super_secure_password_2024" in the content