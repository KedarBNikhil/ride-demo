import { createNavigationContainerRef } from '@react-navigation/native';

// Native overlay actions can cold-start the app, so their route is handled
// outside an individual screen component.
export const captainNavigationRef = createNavigationContainerRef<any>();
