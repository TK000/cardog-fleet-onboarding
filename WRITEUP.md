Write-up

**What I built:**  
I built a fleet onboarding web app that takes a VIN and optional mileage, and returns a verdict (eligible, not eligible, or cannot say), with plain language reasons.

The rules that can make a vehicle not eligible:
- the vehicle model must not be more than 12 years old
- the vehicle type must be a passenger car or MPV
- the vehicle must have at least 4 seats
- the mileage must be no more than 150,000
I thought of this from a rideshare angle, and every rule measures the actual thing that matters (can passengers fit, is the vehicle current) rather than a correlated proxy, and only checks facts the data can really confirm.

Recalls are checked too, but they work differently: an open recall never makes a vehicle not eligible on its own. Any missing data or open recall results in a "cannot say" verdict instead, with a call to action to resolve the unknown (when nothing else already disqualifies the vehicle).

**What I used and why:**  
1. The Cardog api: for VIN identity decode, specs (model-year grain), and recalls. This is the primary source for everything
2. NHTSA’s vPIC API: as a fallback, in case Cardog cannot decode the VIN or doesn’t return data needed for my rule set (eg vehicle type or number of seats). An example of a VIN where this made a difference: WP0CB2A8XMS225298 (Cardog didn’t return data on the vehicle type and number of seats so we sourced it from NHTSA)
3. Claude: I used Claude for guidance on using Next.js and Vercel, since I hadn’t used those technologies before (I have experience with typescript, but on the backend). I also used it to generate a first draft of my code which I then verified and edited. I also used it to generate and find VINs to test my code with.

**The one choice I'd defend:**  
Requiring a VIN, rather than free-text make/model/year. This adds some friction (since most drivers don't have their VIN memorized) but a VIN either decodes to one exact vehicle or it doesn't. Free text would have to go through Cardog's entity-resolve step instead, which can come back with several candidate matches and confidence scores rather than one clear answer. Handling that well would mean building a disambiguation UI and picking a confidence threshold to trust – this would mean more moving parts and another source of uncertainty on top of the gaps Cardog's own data already has. I went with the simpler, more deterministic option.  
A VIN is also something I can actually check, since it either resolves through a real decoder or it doesn't, while free text has nothing to validate against. That said, a decodable VIN only proves it's a real vehicle, not that it's the driver's – a document upload would fix that, and it's what I'd build next.

**What I'd do with another week:**
- Registration-document upload: require the driver to provide photos of their documents (registration, license etc) and extract the VIN from those instead of requiring the driver to know their VIN 
- Parallelize the identity/recalls/specs calls, which currently run sequentially
- Recall severity classification, so a brake defect and a label typo don't read identically. I also noticed some recalls labelled “inconsequential”, which perhaps could be filtered out
- More testing against real VINs — I hand-tested around 25 this weekend, but that's thin coverage for something meant to run unattended

**The question in my brief:**  
A recall is open, and you cannot tell whether this specific unit was already repaired. What does the app say, and what does it ask the driver to do?  
The app says “cannot say” and asks the driver to provide proof of completed repair (dealer service record) to proceed. Cardog can confirm that an open recall campaign exists for this make/model/year, but it cannot confirm whether this specific unit was fixed, and an automatic rejection would claim certainty the data doesn't support. 

**Notes:**  
It’s really hard to find a VIN that actually gets an eligible verdict (I was unable to find one), because most cars have at least one active recall

