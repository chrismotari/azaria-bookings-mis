import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useMemo, useState } from 'react';

import { api } from '../../api/client';
import { Hotel, Paginated, Tour } from '../../api/types';
import { EMPTY_STAY, Stay, stayParams } from '../hotels/HotelParts';

export type TourFilters = {
  departure_city: string;
  destination: string;
  title: string;
  organiser: string;
  date_from: string;
  date_to: string;
  price_min: string;
  price_max: string;
};
export type TourOrdering = 'start_date' | 'from_price';
export const EMPTY_TOUR_FILTERS: TourFilters = {
  departure_city: '',
  destination: '',
  title: '',
  organiser: '',
  date_from: '',
  date_to: '',
  price_min: '',
  price_max: '',
};
type TourList = { filters: TourFilters; ordering: TourOrdering; page: number };

export type HotelFilters = { stars: string; price_min: string; price_max: string };
export type HotelOrdering = 'from_price' | '-star_rating' | 'name';
export const EMPTY_HOTEL_FILTERS: HotelFilters = { stars: '', price_min: '', price_max: '' };
export type HotelSearch = { destination: string; name: string };
export const EMPTY_HOTEL_SEARCH: HotelSearch = { destination: '', name: '' };
type HotelList = { search: HotelSearch; stay: Stay; filters: HotelFilters; ordering: HotelOrdering; page: number };

type Lists = {
  tours: TourList;
  hotels: HotelList;
  setTours: (next: Partial<TourList>) => void;
  setHotels: (next: Partial<HotelList>) => void;
};

const ListsContext = createContext<Lists | null>(null);

/** The tours and hotels search, shared by Explore's tabs and the detail pages' results column. */
export function ExploreListsProvider({ children }: { children: ReactNode }) {
  const [tours, setTourState] = useState<TourList>({ filters: EMPTY_TOUR_FILTERS, ordering: 'start_date', page: 1 });
  const [hotels, setHotelState] = useState<HotelList>({
    search: EMPTY_HOTEL_SEARCH,
    stay: EMPTY_STAY,
    filters: EMPTY_HOTEL_FILTERS,
    ordering: 'from_price',
    page: 1,
  });
  const value = useMemo(
    () => ({
      tours,
      hotels,
      setTours: (next: Partial<TourList>) => setTourState((state) => ({ ...state, ...next })),
      setHotels: (next: Partial<HotelList>) => setHotelState((state) => ({ ...state, ...next })),
    }),
    [tours, hotels],
  );
  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

function useLists() {
  const lists = useContext(ListsContext);
  if (!lists) {
    throw new Error('ExploreListsProvider is missing.');
  }
  return lists;
}

/** The tours search and its results page. */
export function useTourList() {
  const { tours, setTours } = useLists();
  const results = useQuery({
    queryKey: ['tours', tours.filters, tours.ordering, tours.page],
    queryFn: async () => {
      const params = Object.fromEntries(
        Object.entries({ ...tours.filters, ordering: tours.ordering, page: tours.page }).filter(([, value]) =>
          String(value).trim(),
        ),
      );
      return (await api.get<Paginated<Tour>>('/tours', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  return { list: tours, update: setTours, results };
}

/** The hotels search and its results page, priced for the searched stay. */
export function useHotelList() {
  const { hotels, setHotels } = useLists();
  const results = useQuery({
    queryKey: ['hotels', hotels.search, hotels.stay, hotels.filters, hotels.ordering, hotels.page],
    queryFn: async () => {
      const query = Object.fromEntries(
        Object.entries({
          ...hotels.search,
          ...stayParams(hotels.stay),
          ...hotels.filters,
          ordering: hotels.ordering,
          page: hotels.page,
        }).filter(([, value]) => String(value ?? '').trim()),
      );
      return (await api.get<Paginated<Hotel>>('/hotels', { params: query })).data;
    },
    placeholderData: keepPreviousData,
  });
  return { list: hotels, update: setHotels, results };
}
